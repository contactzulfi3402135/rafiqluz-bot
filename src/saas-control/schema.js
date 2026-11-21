'use strict';
// Experimental control-plane schema only. Existing SQLite app is NOT tenant-scoped.
// Bootstrap must run as an administrative migration role; runtime must not be
// superuser, BYPASSRLS, schema owner or table owner. See SAAS-CONTROL-EXPERIMENT.md.
const crypto=require('node:crypto');
const MIGRATION=`
CREATE SCHEMA IF NOT EXISTS raq_control;
CREATE SCHEMA IF NOT EXISTS raq_tenant;
CREATE TABLE IF NOT EXISTS raq_control.schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS raq_control.users(id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS raq_control.workspaces(id uuid PRIMARY KEY, name text NOT NULL, suspended boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS raq_control.memberships(workspace_id uuid NOT NULL REFERENCES raq_control.workspaces(id), user_id uuid NOT NULL REFERENCES raq_control.users(id), role text NOT NULL CHECK(role IN ('owner','admin','editor','viewer')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,user_id));
CREATE INDEX IF NOT EXISTS memberships_user_idx ON raq_control.memberships(user_id, workspace_id);
CREATE TABLE IF NOT EXISTS raq_control.sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES raq_control.users(id), expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sessions_user_idx ON raq_control.sessions(user_id);
CREATE TABLE IF NOT EXISTS raq_control.login_attempts(subject_hash text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL CHECK(attempts > 0));
CREATE TABLE IF NOT EXISTS raq_control.transaction_context(backend_pid integer NOT NULL, tx bigint NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, mode text NOT NULL, PRIMARY KEY(backend_pid,tx));
CREATE OR REPLACE FUNCTION raq_control.open_context(p_token text,p_workspace uuid,p_mode text)
RETURNS TABLE(user_id uuid,role text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid; v_role text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' OR p_mode NOT IN ('read','write','manage','owner') OR p_mode IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT s.user_id INTO v_user FROM raq_control.sessions s JOIN raq_control.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.disabled FOR SHARE OF s,u;
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT m.role INTO v_role FROM raq_control.memberships m JOIN raq_control.workspaces w ON w.id=m.workspace_id
  WHERE m.workspace_id=p_workspace AND m.user_id=v_user AND NOT w.suspended FOR SHARE OF m,w;
 IF v_role IS NULL OR NOT (p_mode='read' OR (p_mode='write' AND v_role IN ('owner','admin','editor')) OR (p_mode='manage' AND v_role IN ('owner','admin')) OR (p_mode='owner' AND v_role='owner')) THEN RAISE EXCEPTION 'Permission denied'; END IF;
 DELETE FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx<>txid_current();
 INSERT INTO raq_control.transaction_context(backend_pid,tx,workspace_id,user_id,role,mode) VALUES(pg_backend_pid(),txid_current(),p_workspace,v_user,v_role,p_mode)
  ON CONFLICT(backend_pid,tx) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,user_id=EXCLUDED.user_id,role=EXCLUDED.role,mode=EXCLUDED.mode;
 RETURN QUERY SELECT v_user,v_role;
END $$;
CREATE OR REPLACE FUNCTION raq_control.active_workspace() RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $$
 SELECT workspace_id FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx=txid_current()
$$;
CREATE OR REPLACE FUNCTION raq_control.can_write() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT mode='write' AND role IN ('owner','admin','editor') FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx=txid_current()),false)
$$;
CREATE OR REPLACE FUNCTION raq_control.close_context() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx=txid_current()
$$;
REVOKE ALL ON FUNCTION raq_control.open_context(text,uuid,text),raq_control.active_workspace(),raq_control.can_write(),raq_control.close_context() FROM PUBLIC;
CREATE TABLE IF NOT EXISTS raq_tenant.workspace_kv(workspace_id uuid NOT NULL REFERENCES raq_control.workspaces(id), key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200), value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,key));
ALTER TABLE raq_tenant.workspace_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE raq_tenant.workspace_kv FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_read ON raq_tenant.workspace_kv FOR SELECT USING (workspace_id = raq_control.active_workspace());
CREATE POLICY workspace_insert ON raq_tenant.workspace_kv FOR INSERT WITH CHECK (workspace_id = raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY workspace_update ON raq_tenant.workspace_kv FOR UPDATE USING (workspace_id = raq_control.active_workspace() AND raq_control.can_write()) WITH CHECK (workspace_id = raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY workspace_delete ON raq_tenant.workspace_kv FOR DELETE USING (workspace_id = raq_control.active_workspace() AND raq_control.can_write());
`;
const checksum=crypto.createHash('sha256').update(MIGRATION).digest('hex');
async function migrate(pool){
  const c=await pool.connect();try{
    await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-control-schema-migration'))");
    await c.query('CREATE SCHEMA IF NOT EXISTS raq_control');
    await c.query('CREATE TABLE IF NOT EXISTS raq_control.schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const existing=await c.query('SELECT checksum FROM raq_control.schema_migrations WHERE version=1');
    if(existing.rowCount){if(existing.rows[0].checksum!==checksum)throw Error('Control schema migration checksum mismatch');}
    else{
      const conflicts=await c.query(`SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('raq_control','raq_tenant') AND c.relkind IN ('r','p','v','m','f','S')
        AND NOT (n.nspname='raq_control' AND c.relname='schema_migrations') LIMIT 1`);
      if(conflicts.rowCount)throw Error('Refusing to initialize over existing control-plane objects');
      await c.query(MIGRATION);await c.query('INSERT INTO raq_control.schema_migrations(version,checksum) VALUES(1,$1)',[checksum]);
    }
    await c.query('COMMIT');return {version:1,checksum};
  }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
}
module.exports={migrate,checksum};
