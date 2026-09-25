import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Anchor, Plus, Search, SlidersHorizontal, Inbox, ClipboardCheck,
  AlertCircle, CheckCircle2, RefreshCw, Paperclip, X, Upload,
  Image as ImageIcon, Loader2, ChevronDown, ChevronRight, ChevronLeft,
  Bug, Lightbulb, HelpCircle, UserCheck, Clock, ArrowUpRight, Users, LayoutList,
  Kanban, ArrowRight, ArrowLeft, ExternalLink, Check, Sparkles
} from 'lucide-react';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './style.css';

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'tester' | 'developer';
type Attachment = { id: string; name: string; size: number; preview?: string };
type LogEntry   = { id: string; action: string; detail: string; created_at: string };
type Project    = { id: string; name: string; description: string };
type ViewMode   = 'board' | 'list';

type Issue = {
  id: string; reference: string; description: string; expected: string;
  type?: 'Bug' | 'Improvement' | 'Question';
  status: string; created_at: string; device: string;
  assigned_to: string; assigned_role: string;
  project_name?: string; project_id?: string;
  attachments: { id: string; name: string }[];
};

const STATUSES = ['New','Assigned','In Progress','Fixed – Needs Retest','Verified','Reopened','Closed'] as const;

const KANBAN_COLUMNS = [
  { id: 'todo', label: 'TO DO', statuses: ['New', 'Assigned', 'Reopened'], color: '#475569', dot: '#94a3b8', targetStatus: 'Assigned' },
  { id: 'inprogress', label: 'IN PROGRESS', statuses: ['In Progress'], color: '#0369a1', dot: '#0284c7', targetStatus: 'In Progress' },
  { id: 'review', label: 'IN REVIEW / RETEST', statuses: ['Fixed – Needs Retest'], color: '#b45309', dot: '#f59e0b', targetStatus: 'Fixed – Needs Retest' },
  { id: 'done', label: 'DONE', statuses: ['Verified', 'Closed'], color: '#047857', dot: '#10b981', targetStatus: 'Verified' },
] as const;

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(url: string, options: RequestInit = {}) {
  const r = await fetch('/api' + url, {
    ...options,
    headers: { 'X-Helm-Request': '1', ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt      = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtFull  = (d: string) => new Date(d).toLocaleString('en-US',    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const reporter = (device: string) => device.replace(/^Submitted by /, '').replace(/ \(.*\)$/, '');
const repRole  = (device: string) => { const m = device.match(/\((.+)\)$/); return m ? m[1] : ''; };

// ─── Components ───────────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  return <span className={`badge ${status.toLowerCase().replaceAll(' ', '-').replaceAll('–','-')}`}><span className="dot" />{status}</span>;
}

function RoleTag({ role }: { role: string }) {
  if (!role) return null;
  const isdev = role === 'developer';
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontWeight:600, padding:'2px 6px', borderRadius:4, background: isdev ? '#eff6ff' : '#fef3c7', color: isdev ? '#1d4ed8' : '#92400e', letterSpacing:'.03em', textTransform:'uppercase' as const }}>
      {isdev ? 'Dev' : 'Tester'}
    </span>
  );
}

function RoleToggle({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div style={{ display:'flex', borderRadius:6, overflow:'hidden', border:'1px solid #dfe4da', width:'fit-content' }}>
      {(['tester','developer'] as Role[]).map(r => (
        <button key={r} type="button" style={{ padding:'5px 10px', fontSize:10, fontWeight:600, cursor:'pointer', border:'none', fontFamily:'inherit', background: value===r ? (r==='tester' ? '#eff6ff' : '#fef3c7') : '#fff', color: value===r ? (r==='tester' ? '#1d4ed8' : '#92400e') : '#9ca58f' }} onClick={() => onChange(r)}>
          {r === 'tester' ? 'Tester' : 'Developer'}
        </button>
      ))}
    </div>
  );
}

function UserAvatar({ name, role, size = 24 }: { name: string; role?: string; size?: number }) {
  if (!name) return <span style={{ width: size, height: size, borderRadius: '50%', border: '1px dashed #cbd5e1', display: 'grid', placeItems: 'center', fontSize: 10, color: '#94a3b8' }}>?</span>;
  const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const isdev = role === 'developer';
  return (
    <span
      title={`${name} (${role || 'unassigned'})`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: isdev ? '#dbeafe' : '#fef3c7',
        color: isdev ? '#1e40af' : '#92400e',
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        flexShrink: 0,
        border: '1px solid rgba(0,0,0,0.08)'
      }}
    >
      {initials}
    </span>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  // Views & Tabs
  const [viewMode, setViewMode]   = useState<ViewMode>('board');
  const [activeTab, setActiveTab] = useState<'issues'|'improvements'|'questions'>('issues');
  const [search, setSearch]       = useState('');
  const [filterRole, setFilterRole] = useState<'all'|'tester'|'developer'|'unassigned'>('all');
  const [filterStatus, setFilterStatus] = useState('');
  const [showFilters, setShowFilters]   = useState(false);

  // Issues & Projects
  const [issues, setIssues]                   = useState<Issue[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [listErr, setListErr]                 = useState('');
  const [projects, setProjects]               = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [workspaceOpen, setWorkspaceOpen]     = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Jira Issue Detail Drawer
  const [selectedIssueId, setSelectedIssueId] = useState<string|null>(null);
  const selectedIssue = issues.find(i => i.id === selectedIssueId);
  const [logs, setLogs]                       = useState<Record<string, LogEntry[]>>({});
  const [logLoading, setLogLoading]           = useState(false);

  // Reassign / Handoff
  const [reassignOpen, setReassignOpen] = useState(false);
  const [raForm, setRaForm] = useState({ actorName:'', actorRole:'tester' as Role, assignedTo:'', assignedRole:'developer' as Role, status:'Assigned', note:'' });
  const [raErr,  setRaErr]  = useState('');
  const [raBusy, setRaBusy] = useState(false);

  // New-issue modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    type: 'Bug' as 'Bug' | 'Improvement' | 'Question',
    name: '', role: 'tester' as Role,
    issue: '', expected: '',
    assignedTo: '', assignedRole: 'developer' as Role,
    status: 'New', projectId: ''
  });
  const [files, setFiles]                   = useState<Attachment[]>([]);
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [addErr, setAddErr]                 = useState('');
  const [addBusy, setAddBusy]               = useState(false);
  const [idempKey, setIdempKey]             = useState(() => crypto.randomUUID());
  const fileRef = useRef<HTMLInputElement>(null);

  // Lightbox
  const [activeImage, setActiveImage] = useState<string|null>(null);

  // Toast
  const [toast, setToast] = useState('');
  const notify = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 5000); }, []);

  // ── Load Data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setListErr('');
    try { setIssues(await api('/guest/issues')); }
    catch (e: any) { setListErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    api('/guest/projects').then((p: Project[]) => {
      setProjects(p);
      if (p.length > 0) setForm(f => ({ ...f, projectId: f.projectId || p[0].id }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) {
        setWorkspaceOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch log when issue is selected in Jira drawer
  useEffect(() => {
    if (selectedIssueId) {
      setLogLoading(true);
      api(`/guest/issues/${selectedIssueId}/log`)
        .then(entries => setLogs(l => ({ ...l, [selectedIssueId]: entries })))
        .catch(() => {})
        .finally(() => setLogLoading(false));
      
      const issue = issues.find(i => i.id === selectedIssueId);
      if (issue) {
        setRaForm({
          actorName: '',
          actorRole: 'tester',
          assignedTo: issue.assigned_to || '',
          assignedRole: (issue.assigned_role as Role) || 'developer',
          status: issue.status || 'Assigned',
          note: ''
        });
      }
    }
  }, [selectedIssueId, issues]);

  // ── Stats & Filtering ─────────────────────────────────────────────────────
  const visibleIssues = selectedProject === 'all' ? issues : issues.filter(i => i.project_id === selectedProject);
  const tabIssues = visibleIssues.filter(i => (i.type || 'Bug') === 'Bug');
  const tabImprovements = visibleIssues.filter(i => i.type === 'Improvement');
  const tabQuestions = visibleIssues.filter(i => i.type === 'Question');

  const currentTabItems = activeTab === 'issues' ? tabIssues : activeTab === 'improvements' ? tabImprovements : tabQuestions;
  const total     = currentTabItems.length;
  const openCount = currentTabItems.filter(i => !['Verified','Closed'].includes(i.status)).length;
  const withDev   = currentTabItems.filter(i => i.assigned_role === 'developer').length;
  const needRetest= currentTabItems.filter(i => i.status === 'Fixed – Needs Retest').length;

  const filtered = currentTabItems.filter(i => {
    if (filterRole === 'tester')     return i.assigned_role === 'tester';
    if (filterRole === 'developer')  return i.assigned_role === 'developer';
    if (filterRole === 'unassigned') return !i.assigned_to;
    return true;
  }).filter(i => {
    if (filterStatus && i.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return i.description.toLowerCase().includes(q) || i.reference?.toLowerCase().includes(q) || reporter(i.device).toLowerCase().includes(q);
    }
    return true;
  });

  // ── Quick Status Transition ───────────────────────────────────────────────
  async function updateStatus(issueId: string, newStatus: string) {
    try {
      await api(`/guest/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          actor_name: 'Status Switcher',
          actor_role: 'developer',
          status: newStatus,
          note: `Moved to ${newStatus}`,
        })
      });
      notify(`Status moved to ${newStatus}`);
      await load();
      if (selectedIssueId === issueId) {
        const e = await api(`/guest/issues/${issueId}/log`);
        setLogs(l => ({ ...l, [issueId]: e }));
      }
    } catch (e: any) {
      notify(`Failed to update status: ${e.message}`);
    }
  }

  // ── Handoff & Reassign ────────────────────────────────────────────────────
  async function saveHandoff(issueId: string) {
    if (!raForm.actorName.trim()) { setRaErr('Enter your name.'); return; }
    setRaBusy(true); setRaErr('');
    try {
      await api(`/guest/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          actor_name: raForm.actorName,
          actor_role: raForm.actorRole,
          assigned_to: raForm.assignedTo,
          assigned_role: raForm.assignedTo ? raForm.assignedRole : '',
          status: raForm.status,
          note: raForm.note,
        })
      });
      setReassignOpen(false);
      const e = await api(`/guest/issues/${issueId}/log`);
      setLogs(l => ({ ...l, [issueId]: e }));
      notify('Handoff saved & status updated.');
      await load();
    } catch (e: any) {
      setRaErr(e.message);
    } finally {
      setRaBusy(false);
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    if (files.length + incoming.length > 5) { setAddErr('Maximum 5 screenshots.'); return; }
    setAddErr(''); setUploading(true);
    const done = [...files];
    for (const file of incoming) {
      if (file.size > 10 * 1024 * 1024) { setAddErr(`${file.name} exceeds 10 MB.`); continue; }
      try {
        const f = new FormData(); f.append('file', file);
        const saved = await new Promise<Attachment>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/guest/upload');
          xhr.setRequestHeader('X-Helm-Request', '1');
          xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100)); };
          xhr.onload = () => { try { const d = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(d) : reject(new Error(d.error)); } catch { reject(new Error('Upload failed.')); } };
          xhr.onerror = () => reject(new Error('Upload failed.'));
          xhr.send(f);
        });
        done.push({ ...saved, preview: URL.createObjectURL(file) });
        setFiles([...done]);
      } catch (e: any) { setAddErr(e.message); }
    }
    setUploading(false); setUploadProgress(0);
  }, [files]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true); setAddErr('');
    try {
      await api('/guest/submit', { method:'POST', body: JSON.stringify({
        reporter_name: form.name, reporter_role: form.role,
        type: form.type,
        issue: form.issue, expected: form.expected,
        assigned_to: form.assignedTo, assigned_role: form.assignedTo ? form.assignedRole : '',
        project_id: form.projectId || (selectedProject !== 'all' ? selectedProject : undefined),
        attachments: files.map(f => f.id), idempotency_key: idempKey,
      })});
      files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
      setFiles([]); setForm(f => ({ ...f, issue:'', expected:'', assignedTo:'' }));
      setIdempKey(crypto.randomUUID());
      setShowModal(false);
      notify(form.type === 'Question' ? 'Question posted successfully.' : form.type === 'Improvement' ? 'Improvement suggested successfully.' : 'Issue reported successfully.');
      await load();
    } catch (e: any) { setAddErr(e.message); }
    finally { setAddBusy(false); }
  }

  const currentProject = projects.find(p => p.id === selectedProject);
  const currentInitials = currentProject ? currentProject.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'HT';
  const currentName = currentProject ? currentProject.name : (selectedProject === 'all' ? 'All Projects' : 'Helm workspace');
  const currentDesc = currentProject ? (currentProject.description || 'Project workspace') : 'Quality, together';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell" style={{ background: '#f4f5f7' }}>

      {/* ── JIRA-STYLE SIDEBAR ── */}
      <aside className="sidebar">
        <a className="brand"><span className="brand-icon"><Anchor size={20} /></span>helm<span className="brand-sub">track</span></a>

        {/* Project Switcher */}
        <div ref={workspaceRef} style={{ position: 'relative' }}>
          <div
            className="workspace"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setWorkspaceOpen(!workspaceOpen)}
            title="Switch project"
          >
            <span className="workspace-icon" style={{
              background: currentProject?.name === 'Glentree' ? '#d1fae5' : '#e7eadf',
              color: currentProject?.name === 'Glentree' ? '#065f46' : '#56704e',
              border: currentProject?.name === 'Glentree' ? '1px solid #a7f3d0' : '1px solid #d8ddcf'
            }}>
              {currentInitials}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentName}
              </strong>
              <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {currentDesc}
              </small>
            </div>
            <ChevronDown size={14} style={{ transform: workspaceOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: '#858c7e', flexShrink: 0 }} />
          </div>

          {workspaceOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: -10,
              background: '#fff',
              border: '1px solid #dce2d4',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(33, 73, 56, 0.15)',
              zIndex: 100,
              overflow: 'hidden',
              padding: '6px 0',
            }}>
              <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: '#90998a', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                Projects
              </div>
              <button
                type="button"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  border: 'none',
                  background: selectedProject === 'all' ? '#eef4e6' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  color: selectedProject === 'all' ? '#254e40' : '#475569',
                  fontWeight: selectedProject === 'all' ? 600 : 400,
                }}
                onClick={() => { setSelectedProject('all'); setWorkspaceOpen(false); }}
              >
                <span style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 4, background: '#e7eadf', fontSize: 10, fontWeight: 700, color: '#56704e' }}>All</span>
                <span style={{ flex: 1 }}>All Projects</span>
                {selectedProject === 'all' && <Check size={13} color="#254e40" />}
              </button>

              {projects.map(p => {
                const init = p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                const isSelected = selectedProject === p.id;
                const isGlentree = p.name === 'Glentree';
                return (
                  <button
                    key={p.id}
                    type="button"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: 'none',
                      background: isSelected ? '#eef4e6' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      color: isSelected ? '#254e40' : '#475569',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onClick={() => { setSelectedProject(p.id); setWorkspaceOpen(false); }}
                  >
                    <span style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      background: isGlentree ? '#d1fae5' : '#e7eadf',
                      color: isGlentree ? '#065f46' : '#56704e',
                      border: isGlentree ? '1px solid #a7f3d0' : '1px solid #d8ddcf',
                      fontSize: 10,
                      fontWeight: 700,
                    }}>{init}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: isSelected ? 600 : 500, fontSize: 12 }}>{p.name}</div>
                    </div>
                    {isSelected && <Check size={13} color="#254e40" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Planning Views */}
        <div className="nav-label">PLANNING</div>
        <nav style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={viewMode === 'board' ? 'active' : ''}
            onClick={() => setViewMode('board')}
          >
            <Kanban size={16} />
            <span>Kanban Board</span>
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            <LayoutList size={16} />
            <span>List</span>
          </button>
        </nav>

        {/* Issue Types */}
        <div className="nav-label">SECTION</div>
        <nav style={{ marginBottom: 18 }}>
          <button
            type="button"
            className={activeTab === 'issues' ? 'active' : ''}
            onClick={() => { setActiveTab('issues'); setFilterStatus(''); }}
          >
            <Bug size={16} />
            <span>Issues</span>
            <b>{tabIssues.length}</b>
          </button>
          <button
            type="button"
            className={activeTab === 'improvements' ? 'active' : ''}
            onClick={() => { setActiveTab('improvements'); setFilterStatus(''); }}
          >
            <Lightbulb size={16} />
            <span>Improvements</span>
            <b>{tabImprovements.length}</b>
          </button>
          <button
            type="button"
            className={activeTab === 'questions' ? 'active' : ''}
            onClick={() => { setActiveTab('questions'); setFilterStatus(''); }}
          >
            <HelpCircle size={16} />
            <span>Questions</span>
            <b>{tabQuestions.length}</b>
          </button>
        </nav>

        {/* Filter by Role */}
        <div className="nav-label">FILTER BY ROLE</div>
        <nav>
          {([['all','All Items', total], ['tester','Testers', currentTabItems.filter(i=>i.assigned_role==='tester').length], ['developer','Developers', withDev], ['unassigned','Unassigned', currentTabItems.filter(i=>!i.assigned_to).length]] as const).map(([val, label, count]) => (
            <button key={val} className={filterRole===val ? 'active' : ''} onClick={() => setFilterRole(val as any)}>
              {val==='all' ? <LayoutList size={16}/> : val==='tester' ? <Users size={16}/> : val==='developer' ? <UserCheck size={16}/> : <Inbox size={16}/>}
              <span>{label}</span>
              {count > 0 && <b>{count}</b>}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="main">
        {/* Topbar */}
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Projects</span>
            <ChevronRight size={13}/>
            <span>{currentName}</span>
            <ChevronRight size={13}/>
            <strong>{activeTab === 'issues' ? 'Issues' : activeTab === 'improvements' ? 'Improvements' : 'Questions & Doubts'}</strong>
          </div>

          <div className="topbar-right">
            {/* View Switcher in Topbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#e9ece3', padding: 3, borderRadius: 7 }}>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 5,
                  border: 'none', background: viewMode === 'board' ? '#fff' : 'transparent',
                  boxShadow: viewMode === 'board' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer', fontSize: 11, fontWeight: viewMode === 'board' ? 700 : 500,
                  color: viewMode === 'board' ? '#254e40' : '#64748b'
                }}
              >
                <Kanban size={13} /> Board
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 5,
                  border: 'none', background: viewMode === 'list' ? '#fff' : 'transparent',
                  boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer', fontSize: 11, fontWeight: viewMode === 'list' ? 700 : 500,
                  color: viewMode === 'list' ? '#254e40' : '#64748b'
                }}
              >
                <LayoutList size={13} /> List
              </button>
            </div>

            <span className="workspace-status"><span />{filtered.length} tickets</span>

            <button className="button" onClick={() => {
              setForm(f => ({ ...f, type: activeTab === 'issues' ? 'Bug' : activeTab === 'improvements' ? 'Improvement' : 'Question' }));
              setShowModal(true);
              setAddErr('');
            }}>
              <Plus size={16} /> {activeTab === 'issues' ? 'Create issue' : activeTab === 'improvements' ? 'Suggest improvement' : 'Ask question / doubt'}
            </button>
          </div>
        </header>

        <div className="content">

          {/* ── STATS CARDS ── */}
          <div className="stats-grid">
            {activeTab === 'issues' ? (
              [
                ['Open issues', openCount, 'Across all stages', Inbox, 'green'],
                ['With developers', withDev, 'Currently in progress', Bug, 'orange'],
                ['Needs retest', needRetest, 'Fixed — awaiting verify', ClipboardCheck, 'yellow'],
                ['Total logged', total, 'All time bug count', CheckCircle2, 'blue'],
              ] as const
            ).map(([label, value, sub, Icon, color]) => (
              <div className="stat-card" key={label}>
                <div><span>{label}</span><Icon size={18} className={color as string} /></div>
                <strong>{value}<span className={`stat-decoration ${color}`}>↗</span></strong>
                <small>{sub}</small>
              </div>
            )) : activeTab === 'improvements' ? (
              [
                ['Active ideas', openCount, 'Open suggestions', Lightbulb, 'green'],
                ['With developers', withDev, 'Under development', UserCheck, 'orange'],
                ['Needs review', needRetest, 'Ready for review', ClipboardCheck, 'yellow'],
                ['Total suggestions', total, 'All improvement ideas', CheckCircle2, 'blue'],
              ] as const
            ).map(([label, value, sub, Icon, color]) => (
              <div className="stat-card" key={label}>
                <div><span>{label}</span><Icon size={18} className={color as string} /></div>
                <strong>{value}<span className={`stat-decoration ${color}`}>↗</span></strong>
                <small>{sub}</small>
              </div>
            )) : (
              [
                ['Open questions', openCount, 'Unanswered or open', HelpCircle, 'green'],
                ['With developers', withDev, 'Dev clarification', UserCheck, 'orange'],
                ['Answered / Check', needRetest, 'Ready to review answer', ClipboardCheck, 'yellow'],
                ['Total questions', total, 'All logged questions', CheckCircle2, 'blue'],
              ] as const
            ).map(([label, value, sub, Icon, color]) => (
              <div className="stat-card" key={label}>
                <div><span>{label}</span><Icon size={18} className={color as string} /></div>
                <strong>{value}<span className={`stat-decoration ${color}`}>↗</span></strong>
                <small>{sub}</small>
              </div>
            ))}
          </div>

          {/* ── RETEST BANNER ── */}
          {needRetest > 0 && (
            <div className="retest-banner">
              <span className="banner-icon"><ClipboardCheck size={22} /></span>
              <div>
                <strong>{activeTab === 'issues' ? 'A fix is ready for retesting.' : activeTab === 'improvements' ? 'An improvement is ready for review.' : 'A question has an answer ready for review.'}</strong>
                <p>{needRetest} {activeTab === 'issues' ? 'issue' : activeTab === 'improvements' ? 'improvement' : 'question'}{needRetest !== 1 ? 's are' : ' is'} marked "Fixed – Needs Retest". Verify or review.</p>
              </div>
              <button onClick={() => setFilterStatus('Fixed – Needs Retest')}>See them <ChevronRight size={15} /></button>
            </div>
          )}

          {/* ── PANEL / BOARD ── */}
          <section className="issue-panel" style={{ border: '1px solid #dfe2d8' }}>
            <div className="panel-heading" style={{ borderBottom: '1px solid #edf0e7' }}>
              <div>
                <h2>{activeTab === 'issues' ? 'Issues' : activeTab === 'improvements' ? 'Improvements' : 'Questions & Doubts'} <span>{filtered.length}</span></h2>
                <p>{viewMode === 'board' ? 'Kanban board view — drag or move tickets across stages.' : 'Spreadsheet list view — filter by role or status.'}</p>
              </div>

              {/* View mode toggle button */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setViewMode(viewMode === 'board' ? 'list' : 'board')}
                  className="button secondary"
                  style={{ padding: '6px 12px', fontSize: 11 }}
                >
                  {viewMode === 'board' ? <><LayoutList size={13} /> Switch to List</> : <><Kanban size={13} /> Switch to Board</>}
                </button>
              </div>
            </div>

            {/* Jira-style Filter & Search Toolbar */}
            <div className="list-toolbar" style={{ borderBottom: '1px solid #f1f4eb', paddingBottom: 14 }}>
              <div className="search-input" style={{ maxWidth: 320 }}>
                <Search size={14} />
                <input placeholder="Search this board…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>

              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto' }}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>

              <button className={`filter-button ${showFilters ? 'selected' : ''}`} onClick={() => setShowFilters(!showFilters)}>
                <SlidersHorizontal size={13} /> Quick filters
              </button>

              {search || filterStatus || filterRole !== 'all' ? (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setFilterStatus(''); setFilterRole('all'); }}
                  style={{ background: 'transparent', border: 'none', color: '#638355', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>

            {showFilters && (
              <div className="extra-filters">
                <select value={filterRole} onChange={e => setFilterRole(e.target.value as any)}>
                  <option value="all">Everyone's tickets</option>
                  <option value="tester">Assigned to testers</option>
                  <option value="developer">Assigned to developers</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </div>
            )}

            {/* ── KANBAN BOARD VIEW ── */}
            {viewMode === 'board' ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(250px, 1fr))',
                gap: 16,
                padding: '20px 22px 28px',
                overflowX: 'auto',
                alignItems: 'start',
                minHeight: 460,
                background: '#f8faf6',
              }}>
                {KANBAN_COLUMNS.map(col => {
                  const colItems = filtered.filter(i => (col.statuses as readonly string[]).includes(i.status));
                  return (
                    <div key={col.id} style={{
                      background: '#edf1e8',
                      borderRadius: 10,
                      border: '1px solid #dce2d4',
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 380,
                    }}>
                      {/* Column Header */}
                      <div style={{
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #dfe5d6',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot }} />
                          <strong style={{ fontSize: 11, letterSpacing: '0.6px', color: col.color, fontWeight: 700 }}>
                            {col.label}
                          </strong>
                        </div>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          background: '#e0e6d8',
                          color: '#475569',
                          padding: '2px 7px',
                          borderRadius: 10,
                        }}>
                          {colItems.length}
                        </span>
                      </div>

                      {/* Cards List */}
                      <div style={{
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        flex: 1,
                      }}>
                        {colItems.length === 0 ? (
                          <div style={{ padding: '28px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, border: '1px dashed #cbd5e1', borderRadius: 8 }}>
                            No tickets
                          </div>
                        ) : (
                          colItems.map(row => (
                            <div
                              key={row.id}
                              onClick={() => setSelectedIssueId(row.id)}
                              style={{
                                background: '#ffffff',
                                borderRadius: 8,
                                border: selectedIssueId === row.id ? '2px solid #254e40' : '1px solid #dce2d4',
                                padding: '12px 14px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
                            >
                              {/* Top row: Type + Key + Project */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  {row.type === 'Question' ? (
                                    <span style={{ display: 'inline-flex', padding: 2, background: '#ede9fe', borderRadius: 4 }}>
                                      <HelpCircle size={12} color="#7c3aed" />
                                    </span>
                                  ) : row.type === 'Improvement' ? (
                                    <span style={{ display: 'inline-flex', padding: 2, background: '#fef3c7', borderRadius: 4 }}>
                                      <Lightbulb size={12} color="#b45309" />
                                    </span>
                                  ) : (
                                    <span style={{ display: 'inline-flex', padding: 2, background: '#fee2e2', borderRadius: 4 }}>
                                      <Bug size={12} color="#dc2626" />
                                    </span>
                                  )}
                                  <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#334155' }}>
                                    {row.reference}
                                  </span>
                                </div>

                                {row.project_name && (
                                  <span style={{ fontSize: 9, fontWeight: 600, color: '#065f46', background: '#d1fae5', padding: '1px 5px', borderRadius: 3 }}>
                                    {row.project_name}
                                  </span>
                                )}
                              </div>

                              {/* Title / Description */}
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', lineHeight: 1.45, marginBottom: 6 }}>
                                {row.description.slice(0, 95)}{row.description.length > 95 ? '…' : ''}
                              </div>

                              {/* Expected / Outcome Snippet */}
                              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, marginBottom: 10 }}>
                                <span style={{ fontWeight: 500 }}>{row.type === 'Question' ? 'Context: ' : row.type === 'Improvement' ? 'Outcome: ' : 'Expected: '}</span>
                                {row.expected.slice(0, 60)}{row.expected.length > 60 ? '…' : ''}
                              </div>

                              {/* Footer: Quick status, attachments, avatar */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {row.attachments?.length > 0 && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#64748b', background: '#f1f5f9', padding: '2px 5px', borderRadius: 3 }}>
                                      <Paperclip size={10} />{row.attachments.length}
                                    </span>
                                  )}
                                  <span style={{ fontSize: 9, color: '#94a3b8' }}>
                                    {fmt(row.created_at)}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {/* Quick Column Advance */}
                                  <select
                                    value={row.status}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => { e.stopPropagation(); updateStatus(row.id, e.target.value); }}
                                    style={{
                                      fontSize: 9,
                                      padding: '2px 4px',
                                      width: 'auto',
                                      borderRadius: 4,
                                      background: '#f8fafc',
                                      border: '1px solid #cbd5e1',
                                      color: '#475569',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>

                                  <UserAvatar name={row.assigned_to} role={row.assigned_role} size={22} />
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (

              /* ── SPREADSHEET LIST VIEW ── */
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{activeTab === 'issues' ? 'Issue' : activeTab === 'improvements' ? 'Improvement' : 'Question'}</th>
                      <th>{activeTab === 'issues' ? 'Reporter' : activeTab === 'improvements' ? 'Suggested By' : 'Asked By'}</th>
                      <th>Assigned To</th>
                      <th>Status</th>
                      <th>Files</th>
                      <th>Date</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedIssueId(row.id)}
                        style={{ cursor: 'pointer', background: selectedIssueId === row.id ? '#f7f9f2' : undefined }}
                      >
                        <td>
                          <div className="issue-title-cell">
                            <span className={`type-icon ${row.type === 'Improvement' ? 'idea' : row.type === 'Question' ? 'question' : 'bug'}`} style={row.type === 'Question' ? { background: '#ede9fe', color: '#7c3aed' } : undefined}>
                              {row.type === 'Improvement' ? <Lightbulb size={15} /> : row.type === 'Question' ? <HelpCircle size={15} /> : <Bug size={15} />}
                            </span>
                            <div>
                              <div className="issue-link" style={{ fontWeight: 600 }}>{row.description.slice(0, 80)}{row.description.length > 80 ? '…' : ''}</div>
                              <div className="issue-meta">
                                <span style={{ fontFamily:'monospace', fontSize:9 }}>{row.reference}</span>
                                {row.project_name && <span style={{ color:'#56704e', fontWeight:600, background:'#eef4e6', padding:'1px 5px', borderRadius:3, fontSize:9 }}>{row.project_name}</span>}
                                <span>·</span>
                                <span>{row.type === 'Question' ? 'Context: ' : row.type === 'Improvement' ? 'Outcome: ' : 'Expected: '}{row.expected.slice(0, 50)}{row.expected.length > 50 ? '…' : ''}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight:500, fontSize:11 }}>{reporter(row.device)}</div>
                          <RoleTag role={repRole(row.device)} />
                        </td>
                        <td>
                          {row.assigned_to ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <UserAvatar name={row.assigned_to} role={row.assigned_role} size={20} />
                              <div>
                                <div style={{ fontWeight:500, fontSize:11 }}>{row.assigned_to}</div>
                                <RoleTag role={row.assigned_role} />
                              </div>
                            </div>
                          ) : (
                            <span style={{ color:'#c8d2be', fontSize:10 }}>Unassigned</span>
                          )}
                        </td>
                        <td><Badge status={row.status} /></td>
                        <td>
                          {row.attachments.length > 0
                            ? <span className="badge" style={{ gap:5 }}><ImageIcon size={10} />{row.attachments.length}</span>
                            : <span style={{ color:'#d4dbc9' }}>—</span>}
                        </td>
                        <td className="date-cell">{fmt(row.created_at)}</td>
                        <td>
                          <ChevronRight size={15} color="#94a3b8" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="table-footer">
              <span>{filtered.length} of {total} items showing</span>
              <button className="button secondary" style={{ padding:'5px 10px', fontSize:10 }} onClick={load}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </section>

          <footer className="main-footer">
            <span>HELM TRACK · JIRA STYLE</span>
            <p>Board · List · Stage Log · Assignments</p>
            <span>Built for better software <span className="footer-dot">●</span></span>
          </footer>
        </div>
      </main>

      {/* ── JIRA ISSUE DETAIL DRAWER ── */}
      {selectedIssue && (
        <>
          {/* Backdrop on mobile */}
          <div
            onClick={() => setSelectedIssueId(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.25)',
              zIndex: 89,
            }}
          />

          <aside style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(620px, 94vw)',
            background: '#ffffff',
            boxShadow: '-8px 0 32px rgba(15, 23, 42, 0.16)',
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid #e2e8f0',
            overflowY: 'auto',
          }}>
            {/* Drawer Header */}
            <div style={{
              padding: '16px 22px',
              borderBottom: '1px solid #edf2f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#fafbf9',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectedIssue.type === 'Question' ? (
                  <span style={{ display: 'inline-flex', padding: 4, background: '#ede9fe', borderRadius: 4 }}>
                    <HelpCircle size={14} color="#7c3aed" />
                  </span>
                ) : selectedIssue.type === 'Improvement' ? (
                  <span style={{ display: 'inline-flex', padding: 4, background: '#fef3c7', borderRadius: 4 }}>
                    <Lightbulb size={14} color="#b45309" />
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', padding: 4, background: '#fee2e2', borderRadius: 4 }}>
                    <Bug size={14} color="#dc2626" />
                  </span>
                )}
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#334155' }}>
                  {selectedIssue.reference}
                </span>
                {selectedIssue.project_name && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#065f46', background: '#d1fae5', padding: '2px 7px', borderRadius: 4 }}>
                    {selectedIssue.project_name}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedIssueId(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#64748b' }}
                title="Close ticket"
              >
                <X size={18} />
              </button>
            </div>

            {/* Jira Status Pill Bar */}
            <div style={{
              padding: '12px 22px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Status:</span>
                <select
                  value={selectedIssue.status}
                  onChange={e => updateStatus(selectedIssue.id, e.target.value)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    width: 'auto',
                    background: '#254e40',
                    color: '#ffffff',
                    border: '1px solid #1f4236',
                  }}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setReassignOpen(!reassignOpen)}
                className="button secondary"
                style={{ padding: '6px 12px', fontSize: 11 }}
              >
                <UserCheck size={13} /> {reassignOpen ? 'Hide Handoff' : 'Handoff / Reassign'}
              </button>
            </div>

            {/* Drawer Body */}
            <div style={{ padding: '22px', flex: 1 }}>

              {/* Title */}
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', lineHeight: 1.4, marginBottom: 16 }}>
                {selectedIssue.description}
              </h2>

              {/* Quick Meta Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                padding: '14px 16px',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                marginBottom: 20,
                fontSize: 11,
              }}>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 10 }}>Assignee</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <UserAvatar name={selectedIssue.assigned_to} role={selectedIssue.assigned_role} size={22} />
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{selectedIssue.assigned_to || 'Unassigned'}</span>
                    <RoleTag role={selectedIssue.assigned_role} />
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 10 }}>{selectedIssue.type === 'Question' ? 'Asked by' : selectedIssue.type === 'Improvement' ? 'Suggested by' : 'Reporter'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <UserAvatar name={reporter(selectedIssue.device)} role={repRole(selectedIssue.device)} size={22} />
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{reporter(selectedIssue.device)}</span>
                    <RoleTag role={repRole(selectedIssue.device)} />
                  </div>
                </div>

                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 10 }}>Project</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{selectedIssue.project_name || 'Glentree'}</span>
                </div>

                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: 10 }}>Created</span>
                  <span style={{ fontWeight: 500, color: '#64748b' }}>{fmtFull(selectedIssue.created_at)}</span>
                </div>
              </div>

              {/* Expected / Benefit Section */}
              <div style={{ marginBottom: 20 }}>
                <strong style={{ fontSize: 12, color: '#334155', display: 'block', marginBottom: 6 }}>
                  {selectedIssue.type === 'Question' ? 'Context / What is unclear' : selectedIssue.type === 'Improvement' ? 'Expected Value / Benefit' : 'Expected Result'}
                </strong>
                <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                  {selectedIssue.expected}
                </div>
              </div>

              {/* Attachments Section */}
              {selectedIssue.attachments?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <strong style={{ fontSize: 12, color: '#334155', display: 'block', marginBottom: 8 }}>
                    Attachments ({selectedIssue.attachments.length})
                  </strong>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {selectedIssue.attachments.map(att => (
                      <div
                        key={att.id}
                        onClick={() => setActiveImage(`/api/guest/attachments/${att.id}`)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
                          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
                          fontSize: 11, cursor: 'pointer', color: '#0369a1'
                        }}
                      >
                        <ImageIcon size={14} />
                        <span>{att.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Handoff / Reassign Form (Tester <-> Dev) */}
              {reassignOpen && (
                <div style={{
                  padding: 16,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 8,
                  marginBottom: 24,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <UserCheck size={15} color="#b45309" />
                    <strong style={{ fontSize: 12, color: '#92400e' }}>Handoff issue to Tester or Developer</strong>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <span>Your name</span>
                      <input placeholder="e.g. Jamie" value={raForm.actorName} onChange={e => setRaForm(f => ({ ...f, actorName: e.target.value }))} />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <span>Your role</span>
                      <RoleToggle value={raForm.actorRole} onChange={r => setRaForm(f => ({ ...f, actorRole: r }))} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <span>Assign to</span>
                      <input placeholder="e.g. Alex" value={raForm.assignedTo} onChange={e => setRaForm(f => ({ ...f, assignedTo: e.target.value }))} />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <span>Their role</span>
                      <RoleToggle value={raForm.assignedRole} onChange={r => setRaForm(f => ({ ...f, assignedRole: r }))} />
                    </div>
                  </div>

                  <div className="field" style={{ marginBottom: 10 }}>
                    <span>Transition Status</span>
                    <select value={raForm.status} onChange={e => setRaForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div className="field" style={{ marginBottom: 12 }}>
                    <span>Handoff note (what was done or what to check)</span>
                    <input placeholder="e.g. Fixed in build v2.6, please retest Safari export" value={raForm.note} onChange={e => setRaForm(f => ({ ...f, note: e.target.value }))} />
                  </div>

                  {raErr && <div className="error" style={{ marginBottom: 10 }}>{raErr}</div>}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="button"
                      disabled={raBusy}
                      onClick={() => saveHandoff(selectedIssue.id)}
                      style={{ fontSize: 11, padding: '7px 14px' }}
                    >
                      {raBusy ? <Loader2 size={13} className="spin" /> : 'Save Handoff'}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setReassignOpen(false)}
                      style={{ fontSize: 11, padding: '7px 14px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Activity & Stage Log Timeline */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                  <Clock size={15} color="#254e40" />
                  <strong style={{ fontSize: 13, color: '#1e293b' }}>Activity & Stage Log</strong>
                </div>

                {logLoading ? (
                  <div className="loading" style={{ padding: '16px 0' }}><Loader2 className="spin" size={16} /> Loading history…</div>
                ) : (logs[selectedIssue.id]?.length ?? 0) === 0 ? (
                  <p className="muted" style={{ fontSize: 11 }}>No activity history recorded yet.</p>
                ) : (
                  <div className="timeline">
                    {logs[selectedIssue.id].map(entry => (
                      <div key={entry.id}>
                        <span className="timeline-dot" />
                        <div>
                          <strong>{entry.action}</strong>
                          <small>{fmtFull(entry.created_at)}</small>
                          {entry.detail && <p style={{ fontSize: 11 }}>{entry.detail}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </aside>
        </>
      )}

      {/* ── IMAGE LIGHTBOX ── */}
      {activeImage && (
        <div
          onClick={() => setActiveImage(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
            zIndex: 110, display: 'grid', placeItems: 'center', padding: 20
          }}
        >
          <img src={activeImage} alt="attachment" style={{ maxWidth: '90%', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} />
        </div>
      )}

      {/* ── NEW ISSUE MODAL ── */}
      {showModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">{form.type === 'Question' ? 'ASK A QUESTION / DOUBT' : form.type === 'Improvement' ? 'SUGGEST AN IMPROVEMENT' : 'REPORT A PROBLEM'}</span>
                <h2 id="modal-title">{form.type === 'Question' ? 'New question / doubt' : form.type === 'Improvement' ? 'New improvement' : 'New issue'}</h2>
                <p>{form.type === 'Question' ? 'Ask for clarification, requirements check, or logic confirmation.' : form.type === 'Improvement' ? 'Suggest a feature, enhancement, or UX refinement.' : 'Tell us what went wrong and what you expected.'}</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={submit}>
              <div className="modal-body">

                {/* Type Choice */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:16 }}>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type:'Bug' }))}
                    style={{
                      padding:'10px 10px', borderRadius:7,
                      border: form.type === 'Bug' ? '2px solid #254e40' : '1px solid #dfe4da',
                      background: form.type === 'Bug' ? '#eef4e6' : '#fff',
                      cursor:'pointer', display:'flex', alignItems:'center', gap:7,
                      fontFamily:'inherit', color: form.type === 'Bug' ? '#254e40' : '#64748b',
                      fontWeight: form.type === 'Bug' ? 700 : 500, fontSize:11,
                    }}
                  >
                    <Bug size={15} color={form.type === 'Bug' ? '#254e40' : '#64748b'} />
                    <span>Bug / Issue</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type:'Improvement' }))}
                    style={{
                      padding:'10px 10px', borderRadius:7,
                      border: form.type === 'Improvement' ? '2px solid #b45309' : '1px solid #dfe4da',
                      background: form.type === 'Improvement' ? '#fef3c7' : '#fff',
                      cursor:'pointer', display:'flex', alignItems:'center', gap:7,
                      fontFamily:'inherit', color: form.type === 'Improvement' ? '#92400e' : '#64748b',
                      fontWeight: form.type === 'Improvement' ? 700 : 500, fontSize:11,
                    }}
                  >
                    <Lightbulb size={15} color={form.type === 'Improvement' ? '#b45309' : '#64748b'} />
                    <span>Improvement</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type:'Question' }))}
                    style={{
                      padding:'10px 10px', borderRadius:7,
                      border: form.type === 'Question' ? '2px solid #7c3aed' : '1px solid #dfe4da',
                      background: form.type === 'Question' ? '#ede9fe' : '#fff',
                      cursor:'pointer', display:'flex', alignItems:'center', gap:7,
                      fontFamily:'inherit', color: form.type === 'Question' ? '#6d28d9' : '#64748b',
                      fontWeight: form.type === 'Question' ? 700 : 500, fontSize:11,
                    }}
                  >
                    <HelpCircle size={15} color={form.type === 'Question' ? '#7c3aed' : '#64748b'} />
                    <span>Question / Doubt</span>
                  </button>
                </div>

                {/* Project selector */}
                {projects.length > 0 && (
                  <div className="field">
                    <span>Project</span>
                    <select
                      value={form.projectId || (selectedProject !== 'all' ? selectedProject : projects[0]?.id)}
                      onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
                    >
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Reporter */}
                <div className="form-grid" style={{ marginBottom:0 }}>
                  <div className="field">
                    <span>Your name</span>
                    <input required minLength={2} placeholder="e.g. Jamie" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                  </div>
                  <div className="field">
                    <span>Your role</span>
                    <RoleToggle value={form.role} onChange={r => setForm(f => ({ ...f, role: r }))} />
                  </div>
                </div>

                <div className="field">
                  <span>{form.type === 'Question' ? 'What is your question or doubt?' : form.type === 'Improvement' ? 'What is the improvement or idea?' : 'What is the issue?'}</span>
                  <textarea
                    required
                    rows={3}
                    placeholder={form.type === 'Question' ? 'Ask what needs clarification or confirmation…' : form.type === 'Improvement' ? 'Describe what can be improved or added…' : 'Describe what went wrong…'}
                    value={form.issue}
                    onChange={e => setForm(f => ({ ...f, issue: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <span>{form.type === 'Question' ? 'Context / What is unclear?' : form.type === 'Improvement' ? 'Why would this help / expected outcome?' : 'What did you expect?'}</span>
                  <textarea
                    required
                    rows={3}
                    placeholder={form.type === 'Question' ? 'Explain what scenario you are testing, what is ambiguous, or what should happen…' : form.type === 'Improvement' ? 'Explain the value or expected benefit…' : 'Describe what should have happened…'}
                    value={form.expected}
                    onChange={e => setForm(f => ({ ...f, expected: e.target.value }))}
                  />
                </div>

                {/* Screenshot */}
                <div className="field">
                  <span>Screenshot (optional)</span>
                  <label className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadFile(e.dataTransfer.files); }}>
                    <Upload size={22} />
                    <strong>{uploading ? `Uploading… ${uploadProgress}%` : 'Drop screenshots here, or browse'}</strong>
                    <span>PNG, JPG, WebP · up to 10 MB · 5 max</span>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={uploading} onChange={e => uploadFile(e.target.files)} />
                  </label>
                  {files.length > 0 && (
                    <div className="upload-previews">
                      {files.map(f => (
                        <div key={f.id}>
                          {f.preview ? <img src={f.preview} alt={f.name} /> : <ImageIcon size={20} />}
                          <span>{f.name}</span>
                          <button type="button" onClick={() => { if (f.preview) URL.revokeObjectURL(f.preview); setFiles(files.filter(x => x.id !== f.id)); }}>
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assign */}
                <div className="form-grid">
                  <div className="field">
                    <span>Assign to (optional)</span>
                    <input placeholder="e.g. Alex" value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} />
                  </div>
                  {form.assignedTo && (
                    <div className="field">
                      <span>Their role</span>
                      <RoleToggle value={form.assignedRole} onChange={r => setForm(f => ({ ...f, assignedRole: r }))} />
                    </div>
                  )}
                  <div className="field">
                    <span>Initial status</span>
                    <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {addErr && <div className="error" role="alert">{addErr}</div>}
              </div>

              <div className="modal-footer">
                <button type="button" className="button secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="button" disabled={addBusy || uploading}>
                  {addBusy ? <><Loader2 size={15} className="spin" />Saving…</> : <><ArrowUpRight size={15} />{form.type === 'Question' ? 'Post question' : form.type === 'Improvement' ? 'Submit improvement' : 'Submit issue'}</>}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />{toast}
          <button aria-label="Dismiss" onClick={() => setToast('')}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
