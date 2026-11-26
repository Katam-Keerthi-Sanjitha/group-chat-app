import React, { useState } from 'react';
import axios from 'axios';

export default function Auth({ API_URL, onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegister) {
        await axios.post(`${API_URL}/api/register`, { name, email, password });
        alert('Registration successful! Please login.');
        setIsRegister(false);
      } else {
        const res = await axios.post(`${API_URL}/api/login`, { email, password });
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        onLoginSuccess(res.data.token, res.data.user);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Authentication error');
    }
  };

  return (
    <div className="auth-bg d-flex justify-content-center align-items-center p-3">
      <div className="card auth-card p-4 p-md-5" style={{ width: '420px' }}>
        <div className="text-center mb-4">
          <div
            className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle text-white fw-bold"
            style={{
              width: '56px',
              height: '56px',
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              fontSize: '1.5rem'
            }}
          >
            💬
          </div>
          <h4 className="fw-bold mb-1">Centralized Group Chat</h4>
          <p className="text-muted small mb-0">
            {isRegister ? 'Create your account to join rooms' : 'Sign in to continue to your groups'}
          </p>
        </div>

        <div className="btn-group w-100 mb-4" role="group">
          <button
            type="button"
            className={`btn btn-sm ${!isRegister ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setIsRegister(false)}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`btn btn-sm ${isRegister ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setIsRegister(true)}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleAuth}>
          {isRegister && (
            <div className="mb-3">
              <label className="form-label small fw-semibold">Full Name</label>
              <input
                className="form-control"
                placeholder="e.g. Keerthi Sanjitha"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}
          <div className="mb-3">
            <label className="form-label small fw-semibold">Email Address</label>
            <input
              className="form-control"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <label className="form-label small fw-semibold">Password</label>
            <input
              className="form-control"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary w-100 py-2 fw-semibold">
            {isRegister ? 'Register Now' : 'Login to Chat'}
          </button>
        </form>
      </div>
    </div>
  );
}
