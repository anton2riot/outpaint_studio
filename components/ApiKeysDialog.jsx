import React, { useEffect, useState } from 'react';

import { loadUserApiKeys, updateUserApiKeys } from '../lib/userApiKeys';

const PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    placeholder: 'AIza…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-…',
  },
];

export default function ApiKeysDialog({ onClose, requiredProvider = null }) {
  const [draft, setDraft] = useState({ gemini: '', openai: '' });
  const [configured, setConfigured] = useState({ gemini: false, openai: false });
  const [remove, setRemove] = useState({ gemini: false, openai: false });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = loadUserApiKeys();
    setConfigured({ gemini: Boolean(saved.gemini), openai: Boolean(saved.openai) });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const body = {};
      for (const provider of PROVIDERS) {
        const id = provider.id;
        if (remove[id]) body[id] = null;
        else if (draft[id].trim()) body[id] = draft[id].trim();
      }
      const saved = updateUserApiKeys(body);
      setConfigured({
        gemini: Boolean(saved.gemini),
        openai: Boolean(saved.openai),
      });
      setDraft({ gemini: '', openai: '' });
      setRemove({ gemini: false, openai: false });
      if (requiredProvider && !saved[requiredProvider]) {
        setError(`Enter a ${requiredProvider === 'openai' ? 'OpenAI' : 'Google Gemini'} key for the selected model.`);
      } else {
        setMessage('Keys are saved in this browser and are already used for new generations.');
      }
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="API key settings"
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form onSubmit={save} className="dialog-panel api-keys-dialog">
        <div className="dialog-header">
          <div>
            <div className="dialog-title">Set API keys</div>
            <div className="dialog-subtitle">
              {requiredProvider
                ? `To generate, enter a key for ${requiredProvider === 'openai' ? 'OpenAI' : 'Google Gemini'}. It will only be saved in this browser.`
                : 'Stored only in this browser.'}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="btn btn-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 2.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        </div>

        {PROVIDERS.map((provider) => {
          const isConfigured = configured[provider.id] && !remove[provider.id];
          return (
            <div key={provider.id} className="api-key-field">
              <span className="api-key-label">
                {provider.label}
                {isConfigured && <span className="api-key-configured">set</span>}
              </span>
              <div className="provider-row">
                <input
                  type="password"
                  autoFocus={requiredProvider === provider.id}
                  autoComplete="off"
                  aria-label={`API key for ${provider.label}`}
                  value={draft[provider.id]}
                  disabled={saving}
                  placeholder={remove[provider.id] ? 'Key will be deleted' : isConfigured ? 'Enter a new key to replace it' : provider.placeholder}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => ({ ...current, [provider.id]: value }));
                    if (value) setRemove((current) => ({ ...current, [provider.id]: false }));
                    setMessage('');
                  }}
                  className="form-control"
                />
                {(configured[provider.id] || remove[provider.id]) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setRemove((current) => ({ ...current, [provider.id]: !current[provider.id] }));
                      setDraft((current) => ({ ...current, [provider.id]: '' }));
                      setMessage('');
                    }}
                    className={`btn btn-sm${remove[provider.id] ? '' : ' btn-danger'}`}
                  >
                    {remove[provider.id] ? 'Cancel' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {error && <div role="alert" className="form-error">{error}</div>}
        {message && <div role="status" className="form-success">{message}</div>}

        <div className="dialog-actions">
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
