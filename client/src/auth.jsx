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
    <div className="container d-flex justify-content-center align-items-center vh-100">
      <div className="card p-4 shadow" style={{ width: '400px' }}>
        <h3 className="text-center mb-3">Group Chat Application</h3>
        <h5 className="text-center text-muted mb-3">{isRegister ? 'Create Account' : 'Sign In'}</h5>
        <form onSubmit={handleAuth}>
          {isRegister && (
            <input className="form-control mb-2" placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <input className="form-control mb-2" type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="form-control mb-3" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn btn-primary w-100 mb-2">{isRegister ? 'Register' : 'Login'}</button>
        </form>
        <button className="btn btn-link w-100" onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
        </button>
      </div>
    </div>
  );
}
