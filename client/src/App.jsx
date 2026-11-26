import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import Auth from './Auth.jsx';

const API_URL = 'http://localhost:5000';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [myRole, setMyRole] = useState('member');
  const [unread, setUnread] = useState({});

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

  if (!token) {
    return <Auth API_URL={API_URL} onLoginSuccess={(t, u) => { setToken(t); setUser(u); }} />;
  }

  return (
    <div className="container-fluid vh-100 d-flex flex-column p-0">
      <nav className="navbar navbar-dark bg-primary px-3">
        <span className="navbar-brand fw-bold">Centralized Group Chat</span>
        <div className="d-flex align-items-center text-white">
          <span className="me-3">Welcome, <strong>{user?.name}</strong></span>
          <button className="btn btn-sm btn-light" onClick={logout}>Logout</button>
        </div>
      </nav>

      <div className="row flex-grow-1 m-0 overflow-hidden">
        <div className="col-md-3 border-end bg-light p-3 overflow-auto h-100">
          <h6>Your Groups</h6>
          <div className="list-group mb-4">
            {groups.map((g) => (
              <button
                key={g.group_id}
                onClick={() => selectGroup(g)}
                className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center ${activeGroup?.group_id === g.group_id ? 'active' : ''}`}
              >
                <div>
                  <div className="fw-bold">{g.group_name}</div>
                  <small>Code: {g.invite_code}</small>
                </div>
                {unread[g.group_id] > 0 && <span className="badge bg-danger rounded-pill">{unread[g.group_id]}</span>}
              </button>
            ))}
          </div>

          <h6>Create New Group</h6>
          <form onSubmit={createGroup} className="mb-4">
            <input className="form-control form-control-sm mb-2" placeholder="Group Name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required />
            <input className="form-control form-control-sm mb-2" placeholder="Description" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} />
            <button className="btn btn-sm btn-success w-100">Create Group</button>
          </form>

          <h6>Join via Invite Code</h6>
          <form onSubmit={joinGroup} className="d-flex gap-1">
            <input className="form-control form-control-sm" placeholder="e.g. A1B2C3" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
            <button className="btn btn-sm btn-outline-primary">Join</button>
          </form>
        </div>

        <div className="col-md-6 d-flex flex-column p-0 h-100">
          {activeGroup ? (
            <>
              <div className="p-3 border-bottom bg-white d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="m-0">{activeGroup.group_name}</h5>
                  <small className="text-muted">{activeGroup.description} | Invite Code: <strong>{activeGroup.invite_code}</strong></small>
                </div>
                <button className="btn btn-sm btn-outline-danger" onClick={leaveGroup}>Leave Group</button>
              </div>

              <div className="flex-grow-1 p-3 overflow-auto bg-body-tertiary">
                {messages.map((m) => (
                  <div key={m.message_id} className={`mb-2 d-flex flex-column ${m.sender_id === user.user_id ? 'align-items-end' : 'align-items-start'}`}>
                    <small className="text-muted">{m.sender_name}</small>
                    <div className={`p-2 rounded ${m.sender_id === user.user_id ? 'bg-primary text-white' : 'bg-white border'}`} style={{ maxWidth: '75%' }}>
                      {m.message_text && <div>{m.message_text}</div>}
                      {m.file_path && (
                        <div className="mt-1">
                          <a href={`${API_URL}${m.file_path}`} target="_blank" rel="noreferrer" className={m.sender_id === user.user_id ? 'text-warning' : 'text-primary'}>
                            📎 {m.file_name}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendMessage} className="p-2 border-top bg-white d-flex gap-2 align-items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="form-control form-control-sm"
                  style={{ maxWidth: '200px' }}
                  onChange={(e) => setFile(e.target.files)}
                />
                <input className="form-control" placeholder="Type a message..." value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn btn-primary">Send</button>
              </form>
            </>
          ) : (
            <div className="d-flex justify-content-center align-items-center h-100 text-muted">
              Select or create a group from the left sidebar to start chatting.
            </div>
          )}
        </div>

        <div className="col-md-3 border-start bg-light p-3 overflow-auto h-100">
          {activeGroup && (
            <>
              <h6>Group Members ({members.length})</h6>
              <ul className="list-group">
                {members.map((m) => (
                  <li key={m.user_id} className="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                      <div>{m.name} {m.role === 'admin' && <span className="badge bg-warning text-dark">Admin</span>}</div>
                      <small className="text-muted">{m.email}</small>
                    </div>
                    {myRole === 'admin' && m.user_id !== user.user_id && (
                      <button className="btn btn-sm btn-danger" onClick={() => removeMember(m.user_id)}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
