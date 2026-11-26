import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import Auth from './Auth.jsx';
import './App.css';

const API_URL = 'http://localhost:5000';

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed'];
const getAvatarColor = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const getInitials = (name = '') =>
  name
    .split(' ')
    .map((n) => n)
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

const formatTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
  return isNaN(date) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [myRole, setMyRole] = useState('member');
  const [unread, setUnread] = useState({});
  const [copied, setCopied] = useState(false);

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);

  const socketRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    if (!token) return;

    const socket = io(API_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      fetchGroups();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleReceiveMessage = (msg) => {
      if (activeGroup && msg.group_id === activeGroup.group_id) {
        setMessages((prev) =>
          prev.some((m) => m.message_id === msg.message_id) ? prev : [...prev, msg]
        );
      } else {
        setUnread((prev) => ({ ...prev, [msg.group_id]: (prev[msg.group_id] || 0) + 1 }));
      }
    };

    const handleMemberJoined = ({ groupId, member }) => {
      if (activeGroup && activeGroup.group_id === groupId) {
        setMembers((prev) =>
          prev.some((m) => m.user_id === member.user_id) ? prev : [...prev, member]
        );
      }
    };

    const handleMemberRemoved = ({ groupId, userId }) => {
      if (user && userId === user.user_id) {
        alert('You were removed from this group.');
        if (activeGroup?.group_id === groupId) setActiveGroup(null);
        fetchGroups();
      } else if (activeGroup && activeGroup.group_id === groupId) {
        setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      }
    };

    const handleAdminChanged = ({ groupId, newAdminId }) => {
      if (activeGroup && activeGroup.group_id === groupId) {
        setMembers((prev) =>
          prev.map((m) => (m.user_id === newAdminId ? { ...m, role: 'admin' } : m))
        );
        if (user && newAdminId === user.user_id) {
          setMyRole('admin');
        }
      }
      fetchGroups();
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('member_joined', handleMemberJoined);
    socket.on('member_removed', handleMemberRemoved);
    socket.on('admin_changed', handleAdminChanged);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('member_joined', handleMemberJoined);
      socket.off('member_removed', handleMemberRemoved);
      socket.off('admin_changed', handleAdminChanged);
    };
  }, [activeGroup, user, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


    const logout = () => {
    localStorage.clear();
    setToken('');
    setUser(null);
    setActiveGroup(null);
  };

  const fetchGroups = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/groups`, authHeaders);
      setGroups(res.data);
      res.data.forEach((g) => socketRef.current?.emit('join_group', g.group_id));
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) logout();
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    await axios.post(
      `${API_URL}/api/groups`,
      { group_name: newGroupName, description: newGroupDesc },
      authHeaders
    );
    setNewGroupName('');
    setNewGroupDesc('');
    fetchGroups();
  };

  const joinGroup = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/api/groups/join`, { invite_code: inviteCode }, authHeaders);
      setInviteCode('');
      await fetchGroups();
      if (res.data.group) selectGroup(res.data.group);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to join');
    }
  };

  const selectGroup = async (group) => {
    setActiveGroup(group);
    setUnread((prev) => ({ ...prev, [group.group_id]: 0 }));
    socketRef.current?.emit('join_group', group.group_id);
    const res = await axios.get(`${API_URL}/api/groups/${group.group_id}/details`, authHeaders);
    setMessages(res.data.messages);
    setMembers(res.data.members);
    setMyRole(res.data.myRole);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) return;

    try {
      let attachment = null;
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await axios.post(`${API_URL}/api/upload`, formData, authHeaders);
        attachment = uploadRes.data;
      }

      socketRef.current?.emit('send_message', {
        group_id: activeGroup.group_id,
        message_text: text,
        attachment
      });

      setText('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send message');
    }
  };

  const removeMember = async (memberId) => {
    await axios.delete(`${API_URL}/api/groups/${activeGroup.group_id}/members/${memberId}`, authHeaders);
    setMembers((prev) => prev.filter((m) => m.user_id !== memberId));
  };

  const leaveGroup = async () => {
    await axios.post(`${API_URL}/api/groups/${activeGroup.group_id}/leave`, {}, authHeaders);
    setActiveGroup(null);
    fetchGroups();
  };

  const copyInviteCode = () => {
    if (!activeGroup?.invite_code) return;
    navigator.clipboard.writeText(activeGroup.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!token) {
    return <Auth API_URL={API_URL} onLoginSuccess={(t, u) => { setToken(t); setUser(u); }} />;
  }

  return (
    <div className="container-fluid vh-100 d-flex flex-column p-0">
      <nav className="navbar app-navbar px-3 shadow-sm">
        <span className="navbar-brand fw-bold text-white d-flex align-items-center gap-2">
          <span className="badge bg-primary rounded-pill">💬</span>
          Centralized Group Chat
        </span>
        <div className="d-flex align-items-center text-white gap-3">
          <div className="d-flex align-items-center gap-2">
            <span className="avatar-circle" style={{ backgroundColor: getAvatarColor(user?.name), width: '30px', height: '30px', fontSize: '0.75rem' }}>
              {getInitials(user?.name)}
            </span>
            <span className="small"><strong>{user?.name}</strong></span>
          </div>
          <button className="btn btn-sm btn-outline-light rounded-pill px-3" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="row flex-grow-1 m-0 overflow-hidden">
        <div className="col-md-3 sidebar-dark p-3 overflow-auto h-100 d-flex flex-column">
          <div className="sidebar-section-title">Your Groups ({groups.length})</div>
          <div className="list-group mb-4">
            {groups.length === 0 && (
              <div className="text-secondary small py-2">No groups yet. Create or join one below!</div>
            )}
            {groups.map((g) => (
              <button
                key={g.group_id}
                onClick={() => selectGroup(g)}
                className={`list-group-item list-group-item-action group-item d-flex justify-content-between align-items-center ${activeGroup?.group_id === g.group_id ? 'active' : ''}`}
              >
                <div className="text-truncate">
                  <div className="fw-semibold text-truncate"># {g.group_name}</div>
                  <small className="opacity-75">Code: {g.invite_code}</small>
                </div>
                {unread[g.group_id] > 0 && (
                  <span className="badge bg-danger rounded-pill">{unread[g.group_id]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="sidebar-section-title">Create New Group</div>
          <form onSubmit={createGroup} className="mb-4">
            <input
              className="form-control form-control-sm dark-input mb-2"
              placeholder="Group Name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              required
            />
            <input
              className="form-control form-control-sm dark-input mb-2"
              placeholder="Description (optional)"
              value={newGroupDesc}
              onChange={(e) => setNewGroupDesc(e.target.value)}
            />
            <button className="btn btn-sm btn-primary w-100 fw-semibold rounded-3">+ Create Group</button>
          </form>

          <div className="sidebar-section-title">Join via Invite Code</div>
          <form onSubmit={joinGroup} className="d-flex gap-2">
            <input
              className="form-control form-control-sm dark-input text-uppercase"
              placeholder="e.g. BMG3O1"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
            />
            <button className="btn btn-sm btn-success px-3 fw-semibold rounded-3">Join</button>
          </form>
        </div>


        <div className="col-md-6 d-flex flex-column p-0 h-100 bg-white">
          {activeGroup ? (
            <>
              <div className="px-4 py-3 border-bottom bg-white d-flex justify-content-between align-items-center shadow-sm" style={{ zIndex: 1 }}>
                <div>
                  <h5 className="fw-bold m-0"># {activeGroup.group_name}</h5>
                  <small className="text-muted">{activeGroup.description || 'Group chat room'}</small>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-light border rounded-pill px-3 fw-semibold"
                    onClick={copyInviteCode}
                    title="Click to copy invite code"
                  >
                    🔑 {activeGroup.invite_code} {copied ? '✅ Copied!' : '📋'}
                  </button>
                  <button className="btn btn-sm btn-outline-danger rounded-pill px-3" onClick={leaveGroup}>
                    Leave
                  </button>
                </div>
              </div>

              <div className="flex-grow-1 p-4 overflow-auto chat-canvas">
                {messages.length === 0 && (
                  <div className="text-center text-muted my-5">
                    <div className="fs-1 mb-2">👋</div>
                    <p className="mb-0">No messages yet. Say hello to start the conversation!</p>
                  </div>
                )}
                {messages.map((m) => {
                  const isMe = m.sender_id === user.user_id;
                  const isImage = m.file_type && m.file_type.startsWith('image/');
                  return (
                    <div key={m.message_id} className={`mb-3 d-flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className="avatar-circle mt-1" style={{ backgroundColor: getAvatarColor(m.sender_name) }}>
                        {getInitials(m.sender_name)}
                      </div>
                      <div className={`d-flex flex-column ${isMe ? 'align-items-end' : 'align-items-start'}`} style={{ maxWidth: '72%' }}>
                        <div className="d-flex align-items-center gap-2 mb-1 px-1">
                          <small className="fw-semibold text-secondary">{isMe ? 'You' : m.sender_name}</small>
                          <small className="text-muted" style={{ fontSize: '0.7rem' }}>{formatTime(m.sent_at)}</small>
                        </div>
                        <div className={`px-3 py-2 ${isMe ? 'msg-bubble-me' : 'msg-bubble-other'}`}>
                          {m.message_text && <div style={{ wordBreak: 'break-word' }}>{m.message_text}</div>}
                          {m.file_path && (
                            <div className="mt-2">
                              {isImage && (
                                <img
                                  src={`${API_URL}${m.file_path}`}
                                  alt={m.file_name}
                                  className="img-fluid rounded mb-1 d-block"
                                  style={{ maxHeight: '200px' }}
                                />
                              )}
                              <a
                                href={`${API_URL}${m.file_path}`}
                                target="_blank"
                                rel="noreferrer"
                                className={`small fw-semibold text-decoration-none ${isMe ? 'text-warning' : 'text-primary'}`}
                              >
                                📎 {m.file_name}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendMessage} className="p-3 border-top bg-white d-flex gap-2 align-items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="form-control form-control-sm"
                  style={{ maxWidth: '210px' }}
                  onChange={(e) => setFile(e.target.files)}
                />
                <input
                  className="form-control rounded-pill px-3"
                  placeholder={`Message #${activeGroup.group_name}...`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <button className="btn btn-primary rounded-pill px-4 fw-semibold">Send</button>
              </form>
            </>
          ) : (
            <div className="d-flex flex-column justify-content-center align-items-center h-100 text-muted chat-canvas p-4 text-center">
              <div className="fs-1 mb-2">💬</div>
              <h5 className="fw-bold text-dark">Welcome to Centralized Group Chat</h5>
              <p className="small mb-0">Select a group on the left or join one with a 6-character invite code.</p>
            </div>
          )}
        </div>

        <div className="col-md-3 border-start bg-white p-3 overflow-auto h-100">
          {activeGroup ? (
            <>
              <div className="sidebar-section-title text-secondary mb-3">
                Members — {members.length}
              </div>
              <div className="d-flex flex-column gap-2">
                {members.map((m) => (
                  <div key={m.user_id} className="p-2 rounded-3 border bg-light d-flex justify-content-between align-items-center">
                    <div className="d-flex align-items-center gap-2 text-truncate">
                      <div className="avatar-circle" style={{ backgroundColor: getAvatarColor(m.name) }}>
                        {getInitials(m.name)}
                      </div>
                      <div className="text-truncate">
                        <div className="fw-semibold small text-truncate d-flex align-items-center gap-1">
                          {m.name}
                          {m.role === 'admin' && (
                            <span className="badge bg-warning text-dark" style={{ fontSize: '0.65rem' }}>Admin</span>
                          )}
                        </div>
                        <div className="text-muted text-truncate" style={{ fontSize: '0.72rem' }}>{m.email}</div>
                      </div>
                    </div>
                    {myRole === 'admin' && m.user_id !== user.user_id && (
                      <button className="btn btn-sm btn-outline-danger py-0 px-2" onClick={() => removeMember(m.user_id)}>
                        Kick
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-muted small text-center mt-5">
              Open a group to see its members and roles.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
