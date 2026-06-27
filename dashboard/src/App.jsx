import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import LiquidEther from './components/LiquidEther';
import SpotlightCard from './components/SpotlightCard';
import Counter from './components/Counter';
import StarBorder from './components/StarBorder';
import AnimatedList from './components/AnimatedList';
import { ShieldCheck, ShieldAlert, Cpu, Settings, Activity, Users, Globe } from 'lucide-react';
import './App.css';

// Connect to socket.io backend
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin;
const API_URL = SOCKET_URL;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [activeClients, setActiveClients] = useState({});
  
  // Metric counts
  const [totalChecks, setTotalChecks] = useState(0);
  const [allowedChecks, setAllowedChecks] = useState(0);
  const [deniedChecks, setDeniedChecks] = useState(0);
  const [rps, setRps] = useState(0);

  // Form states
  const [clientId, setClientId] = useState('user_123');
  const [endpoint, setEndpoint] = useState('');
  const [algorithm, setAlgorithm] = useState('tokenBucket');
  const [limit, setLimit] = useState(10);
  const [refillRate, setRefillRate] = useState(2);
  const [burstSize, setBurstSize] = useState(15);
  const [windowSize, setWindowSize] = useState(60);

  // UI States
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  // Timestamps of checks to calculate real-time RPS
  const checkTimestampsRef = useRef([]);

  useEffect(() => {
    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to socket.io rate-limiter stream');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from socket.io rate-limiter stream');
    });

    // Real-time log event listener
    socket.on('rateCheck', (event) => {
      // Append new event to the top of logs list
      setLogs((prevLogs) => [
        {
          id: `${event.timestamp}-${Math.random()}`,
          element: renderLogItem(event),
          ...event
        },
        ...prevLogs.slice(0, 49) // Keep max 50 logs
      ]);

      // Track active clients status registry
      setActiveClients((prev) => {
        const key = event.endpoint ? `${event.clientId}:${event.endpoint}` : event.clientId;
        return {
          ...prev,
          [key]: {
            clientId: event.clientId,
            endpoint: event.endpoint,
            allowed: event.allowed,
            remaining: event.remaining,
            limit: event.limit,
            algorithm: event.algorithm,
            timestamp: event.timestamp
          }
        };
      });

      // Update counters
      setTotalChecks((prev) => prev + 1);
      if (event.allowed) {
        setAllowedChecks((prev) => prev + 1);
      } else {
        setDeniedChecks((prev) => prev + 1);
      }

      // Track timestamps for RPS
      checkTimestampsRef.current.push(Date.now());
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Calculate RPS on a 1-second interval
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      checkTimestampsRef.current = checkTimestampsRef.current.filter(
        (ts) => now - ts < 1000
      );
      setRps(checkTimestampsRef.current.length);
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // Save client configuration
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback({ type: '', message: '' });

    try {
      const payload = {
        clientId,
        algorithm,
        limit: Number(limit)
      };

      if (endpoint && endpoint.trim() !== '') {
        payload.endpoint = endpoint.trim();
      }

      if (algorithm === 'tokenBucket') {
        payload.refillRate = Number(refillRate);
        payload.burstSize = Number(burstSize);
      } else {
        payload.windowSize = Number(windowSize);
      }

      const response = await fetch(`${API_URL}/admin/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (response.ok) {
        setFeedback({
          type: 'success',
          message: `Config saved for client "${clientId}"${endpoint ? ` on endpoint "${endpoint}"` : ''}!`
        });
      } else {
        const errorMsg = data.details ? data.details.join(', ') : data.error;
        setFeedback({
          type: 'error',
          message: errorMsg || 'Failed to save configuration.'
        });
      }
    } catch (err) {
      console.error(err);
      setFeedback({ type: 'error', message: 'Failed to connect to API server.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to trigger a live check endpoint request for testing
  const triggerCheck = async (testClientId, testEndpoint) => {
    try {
      const payload = { clientId: testClientId };
      if (testEndpoint) payload.endpoint = testEndpoint;

      await fetch(`${API_URL}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Error triggering rate check:', err);
    }
  };

  // Run a rapid burst check for testing
  const triggerBurst = async (testClientId, testEndpoint, count = 10) => {
    for (let i = 0; i < count; i++) {
      triggerCheck(testClientId, testEndpoint);
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  // Custom log element rendering
  const renderLogItem = (event) => {
    const timeStr = new Date(event.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    return (
      <div className={`log-row-container ${event.allowed ? 'allowed-log' : 'denied-log'}`}>
        <div className="log-row">
          <div className="log-left">
            <span className={`badge ${event.allowed ? 'allowed' : 'denied'}`}>
              {event.allowed ? 'ALLOW' : 'DENY'}
            </span>
            <span className="log-client-id">{event.clientId}</span>
            {event.endpoint && (
              <span className="badge endpoint-badge">
                <Globe size={10} style={{ marginRight: '3px' }} />
                {event.endpoint}
              </span>
            )}
            <span className="badge algo">
              {event.algorithm === 'tokenBucket' ? 'Token Bucket' : 'Sliding Window'}
            </span>
          </div>
          <div className="log-right">
            <span className="log-remaining">
              Rem: {event.remaining}/{event.limit}
            </span>
            {!event.allowed && event.retryAfter > 0 && (
              <span className="badge denied" style={{ fontSize: '11px' }}>
                Retry: {event.retryAfter}s
              </span>
            )}
            <span className="log-time">{timeStr}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* Premium backdrop fluid animation */}
      <div className="ether-bg-container">
        <LiquidEther
          colors={['#2bee4b', '#93b799', '#fafffa']}
          mouseForce={15}
          cursorSize={80}
          autoDemo={true}
          autoSpeed={0.3}
          resolution={0.4}
        />
      </div>

      <div className="dashboard-content">
        {/* Masthead Header */}
        <header className="dashboard-header">
          <div>
            <div className="dashboard-logo">NewForm // Microservice</div>
            <h1 className="dashboard-title serif-display">
              Rate<span className="text-voltage">.</span>Limiter
            </h1>
          </div>
          <div className="dashboard-status">
            <span className={`status-dot ${connected ? '' : 'offline'}`} />
            {connected ? 'LIVE CONNECTION ACTIVE' : 'API DISCONNECTED'}
          </div>
        </header>

        {/* Live Metrics Grid */}
        <section className="metrics-grid">
          <SpotlightCard className="metric-card">
            <div className="metric-label">Total Checks</div>
            <div className="metric-value-container">
              <span className="metric-value">
                <Counter value={totalChecks} />
              </span>
              <Activity size={24} className="text-voltage" />
            </div>
            <div className="metric-subtext">Cumulative rate checks handled</div>
          </SpotlightCard>

          <SpotlightCard className="metric-card">
            <div className="metric-label">Allowed Passes</div>
            <div className="metric-value-container">
              <span className="metric-value">
                <Counter value={allowedChecks} />
              </span>
              <ShieldCheck size={24} style={{ color: '#2bee4b' }} />
            </div>
            <div className="metric-subtext">Requests matching rate quotas</div>
          </SpotlightCard>

          <SpotlightCard className="metric-card">
            <div className="metric-label">Blocked Requests</div>
            <div className="metric-value-container">
              <span className="metric-value">
                <Counter value={deniedChecks} />
              </span>
              <ShieldAlert size={24} style={{ color: '#ff3b30' }} />
            </div>
            <div className="metric-subtext">Requests that exceeded rate limits</div>
          </SpotlightCard>

          <SpotlightCard className="metric-card">
            <div className="metric-label">Live Throughput</div>
            <div className="metric-value-container">
              <span className="metric-value">
                <Counter value={rps} />
              </span>
              <Cpu size={24} className="text-voltage" />
            </div>
            <div className="metric-subtext">Requests per second (RPS)</div>
          </SpotlightCard>
        </section>

        {/* Dashboard Split View */}
        <div className="main-sections-grid">
          
          {/* Left Panel: Config Card + Active Client Registry */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {/* Admin Config Section */}
            <section className="config-card">
              <h2 className="section-title">Client Quota Configuration</h2>
              
              {feedback.message && (
                <div style={{
                  padding: '10px 15px',
                  borderRadius: '6px',
                  marginBottom: '20px',
                  fontSize: '13px',
                  backgroundColor: feedback.type === 'success' ? 'rgba(43, 238, 75, 0.15)' : 'rgba(255, 59, 48, 0.08)',
                  color: feedback.type === 'success' ? '#1b852c' : '#ff3b30',
                  border: `1px solid ${feedback.type === 'success' ? 'rgba(43, 238, 75, 0.3)' : 'rgba(255, 59, 48, 0.15)'}`
                }}>
                  {feedback.message}
                </div>
              )}

              <form onSubmit={handleSaveConfig}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Client ID</label>
                    <input
                      type="text"
                      className="form-input"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="e.g. user_123"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Endpoint (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="e.g. /checkout"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Limiting Algorithm</label>
                  <select
                    className="form-select"
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value)}
                  >
                    <option value="tokenBucket">Token Bucket (bursty)</option>
                    <option value="slidingWindow">Sliding Window (strict)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Max Limit (Capacity)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    required
                    min="1"
                  />
                </div>

                {algorithm === 'tokenBucket' ? (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Refill Rate (Tokens/sec)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        value={refillRate}
                        onChange={(e) => setRefillRate(e.target.value)}
                        required
                        min="0.01"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Burst Size (Capacity)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={burstSize}
                        onChange={(e) => setBurstSize(e.target.value)}
                        required
                        min="1"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Sliding Window Size (Seconds)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={windowSize}
                      onChange={(e) => setWindowSize(e.target.value)}
                      required
                      min="1"
                    />
                  </div>
                )}

                <div className="submit-btn-wrapper">
                  <StarBorder
                    type="submit"
                    disabled={submitting}
                    className="star-btn"
                    color="#2bee4b"
                  >
                    <Settings size={16} />
                    {submitting ? 'Saving Configuration...' : 'Save Configuration'}
                  </StarBorder>
                </div>
              </form>

              <div style={{ marginTop: '25px', paddingTop: '15px', borderTop: '1px solid var(--color-mist)' }}>
                <div className="form-label" style={{ marginBottom: '10px' }}>Simulate Client Traffic</div>
                <div className="simulation-triggers">
                  <button
                    type="button"
                    className="sim-btn"
                    onClick={() => triggerCheck(clientId, endpoint)}
                  >
                    Check Scoped
                  </button>
                  <button
                    type="button"
                    className="sim-btn"
                    onClick={() => triggerBurst(clientId, endpoint, 5)}
                  >
                    Burst Scoped (5x)
                  </button>
                  <button
                    type="button"
                    className="sim-btn"
                    onClick={() => triggerBurst(clientId, '/checkout', 3)}
                  >
                    Burst /checkout (3x)
                  </button>
                </div>
              </div>
            </section>

            {/* Active Clients Registry Section */}
            <section className="config-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <Users size={18} className="text-voltage" />
                <h2 className="section-title" style={{ marginBottom: 0, fontSize: '22px' }}>Active Client Registry</h2>
              </div>
              
              {Object.keys(activeClients).length === 0 ? (
                <div className="no-logs-msg" style={{ height: '80px', fontSize: '13px' }}>
                  No active clients tracked in this session yet.
                </div>
              ) : (
                <div className="active-clients-container" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-mist)', textAlign: 'left', color: 'var(--color-sage)' }}>
                        <th style={{ padding: '6px 0' }}>Client : Endpoint</th>
                        <th>Algo</th>
                        <th>Quota</th>
                        <th style={{ textAlign: 'right' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(activeClients).map(([key, client]) => (
                        <tr key={key} style={{ borderBottom: '1px solid rgba(18, 22, 19, 0.05)' }}>
                          <td style={{ padding: '8px 0', fontWeight: 600 }}>
                            {client.clientId}
                            {client.endpoint && (
                              <span style={{ color: 'var(--color-sage)', fontWeight: 400, marginLeft: '4px' }}>
                                ({client.endpoint})
                              </span>
                            )}
                          </td>
                          <td style={{ color: 'var(--color-sage)' }}>
                            {client.algorithm === 'tokenBucket' ? 'Token' : 'Window'}
                          </td>
                          <td>
                            {client.remaining} / {client.limit}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span 
                              className="status-dot" 
                              style={{ 
                                backgroundColor: client.allowed ? 'var(--color-voltage)' : '#ff3b30',
                                boxShadow: `0 0 8px ${client.allowed ? 'var(--color-voltage)' : '#ff3b30'}`
                              }} 
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Right Panel: Live Request Stream */}
          <section className="logs-card">
            <div className="logs-header">
              <h2 className="section-title" style={{ marginBottom: 0 }}>Live Request Stream</h2>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-sage)' }}>
                showing last {logs.length} entries
              </span>
            </div>

            {logs.length === 0 ? (
              <div className="no-logs-msg">
                Waiting for rate limit check events from microservice...
              </div>
            ) : (
              <AnimatedList items={logs} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
