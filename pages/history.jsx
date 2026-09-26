import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';
import { requireUser } from '../lib/requestAuth';

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '';

export async function getServerSideProps({ req, res }) {
  await requireUser(req, res);
  return { props: {} };
}

const MODEL_NAMES = {
  'gemini-2.5-flash-image': 'NanoBanana',
  'gemini-3.1-flash-image-preview': 'NanoBanana 2',
  'gemini-3.1-flash-image': 'NanoBanana 2',
  'gemini-3-pro-image-preview': 'NanoBanana Pro',
  'gemini-3-pro-image': 'NanoBanana Pro',
  'gpt-image-2': 'ChatGPT 2',
  'gpt-image-2.5-sunburst': 'ChatGPT Sunburst',
  'gpt-image-2.5-flare': 'ChatGPT Flare',
};

function ArrowLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m15 18-6-6 6-6M9 12h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function dayKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

function formatTime(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatMoney(value, compact = false) {
  if (!Number.isFinite(value)) return '—';
  const digits = compact ? (value < 0.01 ? 4 : 2) : (value < 0.01 ? 4 : 3);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
}

function statusLabel(status) {
  if (status === 'completed') return 'Готово';
  if (status === 'error') return 'Ошибка';
  return 'В процессе';
}

function modelName(entry) {
  const id = entry.settings?.modelName;
  return MODEL_NAMES[id] || id || (entry.kind === 'gemini' ? 'Gemini' : 'OpenAI');
}

export default function GenerationHistoryPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${BP}/api/generation-history`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить историю');
        if (active) setEntries(data.entries || []);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const days = useMemo(() => {
    const grouped = new Map();
    entries.forEach((entry) => {
      const key = dayKey(entry.createdAt);
      const current = grouped.get(key) || {
        key,
        count: 0,
        completed: 0,
        errors: 0,
        amount: 0,
        priced: 0,
        estimated: false,
      };
      current.count += 1;
      if (entry.status === 'completed') current.completed += 1;
      if (entry.status === 'error') current.errors += 1;
      if (Number.isFinite(entry.cost?.amountUsd)) {
        current.amount += entry.cost.amountUsd;
        current.priced += 1;
        current.estimated ||= Boolean(entry.cost.estimated);
      }
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [entries]);

  const totals = useMemo(() => ({
    amount: days.reduce((sum, day) => sum + day.amount, 0),
    completed: entries.filter((entry) => entry.status === 'completed').length,
    priced: entries.filter((entry) => Number.isFinite(entry.cost?.amountUsd)).length,
    estimated: entries.some((entry) => entry.cost?.estimated),
  }), [days, entries]);

  const maxDayAmount = Math.max(...days.map((day) => day.amount), 0);

  return (
    <>
      <Head>
        <title>История генераций — Аутпейнт</title>
      </Head>
      <main className="history-page">
        <header className="history-header">
          <div className="history-header-inner">
            <a className="history-back" href={`${BP}/`} aria-label="Вернуться на холст">
              <ArrowLeftIcon />
              <span>Холст</span>
            </a>
            <div>
              <h1>История генераций</h1>
              <p>Стоимость запросов и расходы по дням</p>
            </div>
          </div>
        </header>

        <div className="history-content">
          {loading && <div className="history-message">Загружаем историю…</div>}
          {error && <div className="history-message history-message-error">{error}</div>}

          {!loading && !error && (
            <>
              <section className="history-overview" aria-label="Общая статистика">
                <div className="history-overview-item history-overview-primary">
                  <span>Учтённые расходы</span>
                  <strong>{formatMoney(totals.amount)}</strong>
                  <small>
                    {totals.priced} из {entries.length} записей с ценой
                    {totals.estimated ? ', включая оценки' : ''}
                  </small>
                </div>
                <div className="history-overview-item">
                  <span>Генерации</span>
                  <strong>{totals.completed}</strong>
                  <small>из {entries.length}</small>
                </div>
                <div className="history-overview-item">
                  <span>Дни</span>
                  <strong>{days.length}</strong>
                  <small>{days[0] ? formatDay(days[0].key) : '—'}</small>
                </div>
              </section>

              <section className="history-section">
                <div className="history-section-title">
                  <h2>Расходы по дням</h2>
                </div>
                {days.length === 0 ? (
                  <div className="history-empty">Генераций пока нет</div>
                ) : (
                  <div className="daily-list">
                    {days.map((day) => (
                      <div className="daily-row" key={day.key}>
                        <div className="daily-date">{formatDay(day.key)}</div>
                        <div className="daily-bar-wrap" aria-hidden>
                          <div
                            className="daily-bar"
                            style={{ width: `${maxDayAmount && day.amount ? Math.max(3, day.amount / maxDayAmount * 100) : 0}%` }}
                          />
                        </div>
                        <div className="daily-meta">
                          <span>
                            {day.completed} готово{day.errors ? ` · ${day.errors} с ошибкой` : ''}
                            {day.priced === 0
                              ? ' · без данных о цене'
                              : day.priced < day.count ? ` · цена у ${day.priced}` : ''}
                          </span>
                          <strong>
                            {day.priced ? <>{day.estimated ? '≈ ' : ''}{formatMoney(day.amount, true)}</> : '—'}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="history-section history-log-section">
                <div className="history-section-title">
                  <h2>Все генерации <span>{entries.length}</span></h2>
                </div>
                <div className="generation-table">
                  <div className="generation-table-head" aria-hidden>
                    <span>Дата</span>
                    <span>Модель</span>
                    <span>Параметры</span>
                    <span>Статус</span>
                    <span>Стоимость</span>
                  </div>
                  {entries.map((entry) => {
                    const amount = entry.cost?.amountUsd;
                    return (
                      <div className="generation-row" key={entry.id}>
                        <time dateTime={entry.createdAt}>
                          <strong>{formatTime(entry.createdAt)}</strong>
                          <span>{formatDay(dayKey(entry.createdAt))}</span>
                        </time>
                        <div className="generation-model">{modelName(entry)}</div>
                        <div className="generation-params">
                          {entry.settings?.imageSize || '—'} · {entry.settings?.aspectRatio || '—'}
                        </div>
                        <span className={`generation-status status-${entry.status}`}>{statusLabel(entry.status)}</span>
                        <div className="generation-cost">
                          <strong>{entry.cost?.estimated ? '≈ ' : ''}{formatMoney(amount)}</strong>
                        </div>
                      </div>
                    );
                  })}
                  {entries.length === 0 && <div className="history-empty">Генераций пока нет</div>}
                </div>
              </section>

              <p className="history-footnote">
                Суммы указаны в долларах США. «По usage» — расчёт по токенам ответа API; «оценка» — расчёт старой записи по модели и разрешению.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
