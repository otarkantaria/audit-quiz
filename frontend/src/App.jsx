import { useState, useEffect, useRef } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_URL || ''

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function loadCorrectIds() {
  try {
    const data = localStorage.getItem('audit_quiz_correct_ids')
    return data ? new Set(JSON.parse(data)) : new Set()
  } catch {
    return new Set()
  }
}

function saveCorrectIds(idSet) {
  localStorage.setItem('audit_quiz_correct_ids', JSON.stringify([...idSet]))
}

function loadSessions() {
  try {
    const data = localStorage.getItem('audit_quiz_sessions')
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveSessions(sessions) {
  localStorage.setItem('audit_quiz_sessions', JSON.stringify(sessions))
}

function getToken() { return localStorage.getItem('audit_quiz_token') }
function getUsername() { return localStorage.getItem('audit_quiz_username') }
function setAuth(token, username) {
  localStorage.setItem('audit_quiz_token', token)
  localStorage.setItem('audit_quiz_username', username)
}
function clearAuth() {
  localStorage.removeItem('audit_quiz_token')
  localStorage.removeItem('audit_quiz_username')
}

function authHeaders() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const HANDBOOK_TOPICS = ['შუალედური გამოცდა', 'სახელმძღვანელო']
const COUNT_STOPS = [10, 30, 60]

function App() {
  const [view, setView] = useState('home')
  const [bank, setBank] = useState([])
  const [selectedSources, setSelectedSources] = useState(new Set(['handbook', 'ai']))
  const [questionCount, setQuestionCount] = useState(30)
  const [questions, setQuestions] = useState([])
  const [currentQ, setCurrentQ] = useState(0)
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults] = useState(null)
  const [sessions, setSessions] = useState(loadSessions)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const [elapsed, setElapsed] = useState(0)
  const [reviewMode, setReviewMode] = useState(false)
  const [revealed, setRevealed] = useState({})
  const [reviewStatus, setReviewStatus] = useState(() => {
    try {
      const saved = localStorage.getItem('audit_quiz_reviews')
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })
  const [cards, setCards] = useState([])
  const [currentCard, setCurrentCard] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [correctIds, setCorrectIds] = useState(loadCorrectIds)

  // Auth state
  const [user, setUser] = useState(getUsername)
  const [authForm, setAuthForm] = useState({ username: '', password: '' })
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState(null)
  const [authLoading, setAuthLoading] = useState(false)

  const correctSoFar = Object.keys(answers).filter(qId => {
    const q = questions.find(x => x.id === qId)
    return q && answers[qId] === q.correct
  }).length
  const wrongSoFar = Object.keys(revealed).length - correctSoFar

  useEffect(() => {
    fetch('./question_bank.json')
      .then(res => res.json())
      .then(data => {
        setBank(data)
        setLoading(false)
      })
      .catch(() => {
        setError('კითხვების ბანკის ჩატვირთვა ვერ მოხერხდა')
        setLoading(false)
      })
  }, [])

  // Load progress from server on login
  useEffect(() => {
    if (!user) return
    fetch(`${API}/api/progress`, { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) { handleLogout(); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        if (data.correct_ids) {
          const merged = loadCorrectIds()
          for (const id of data.correct_ids) merged.add(id)
          saveCorrectIds(merged)
          setCorrectIds(merged)
        }
        if (data.sessions) {
          saveSessions(data.sessions)
          setSessions(data.sessions)
        }
      })
      .catch(() => {})
  }, [user])

  const handbookCount = bank.filter(q => HANDBOOK_TOPICS.includes(q.topic)).length
  const aiCount = bank.filter(q => !HANDBOOK_TOPICS.includes(q.topic)).length
  const handbookDone = bank.filter(q => HANDBOOK_TOPICS.includes(q.topic) && correctIds.has(q.id)).length
  const aiDone = bank.filter(q => !HANDBOOK_TOPICS.includes(q.topic) && correctIds.has(q.id)).length

  function getPool(mcqOnly = false) {
    let pool = bank
    if (mcqOnly) pool = pool.filter(q => q.type !== 'open')
    if (selectedSources.size === 0) return pool
    if (selectedSources.has('handbook') && selectedSources.has('ai')) return pool
    if (selectedSources.has('handbook')) return pool.filter(q => HANDBOOK_TOPICS.includes(q.topic))
    if (selectedSources.has('ai')) return pool.filter(q => !HANDBOOK_TOPICS.includes(q.topic))
    return pool
  }

  function toggleSource(src) {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(src)) next.delete(src)
      else next.add(src)
      return next
    })
  }

  function startQuiz() {
    const pool = getPool(true)
    const selected = shuffleArray(pool).slice(0, questionCount)
    if (!selected.length) { setError('კითხვები ვერ მოიძებნა'); return }
    setQuestions(selected)
    setCurrentQ(0)
    setAnswers({})
    setSubmitted(false)
    setResults(null)
    setElapsed(0)
    setReviewMode(false)
    setRevealed({})
    setReviewStatus({})
    setView('quiz')
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }

  function startCards() {
    const pool = getPool(false)
    const selected = shuffleArray(pool).slice(0, questionCount)
    if (!selected.length) { setError('კითხვები ვერ მოიძებნა'); return }
    setCards(selected)
    setCurrentCard(0)
    setFlipped(false)
    setView('cards')
  }

  function syncToServer(newCorrectIds, sessionData) {
    if (!user) return
    const body = {}
    if (newCorrectIds.length) body.correct_ids = newCorrectIds
    if (sessionData) body.session = sessionData
    fetch(`${API}/api/progress/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }).catch(() => {})
  }

  function selectAnswer(questionId, option) {
    if (revealed[questionId]) return
    setAnswers(prev => ({ ...prev, [questionId]: option }))
    setRevealed(prev => ({ ...prev, [questionId]: true }))
    const q = questions.find(x => x.id === questionId)
    if (q && option === q.correct) {
      setCorrectIds(prev => {
        const next = new Set(prev)
        next.add(questionId)
        saveCorrectIds(next)
        return next
      })
      syncToServer([questionId], null)
    }
  }

  function submitQuiz() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    let correct = 0
    const resultList = []
    for (const q of questions) {
      const userAnswer = answers[q.id]
      const isCorrect = userAnswer === q.correct
      if (isCorrect) correct++
      resultList.push({ question_id: q.id, user_answer: userAnswer, correct_answer: q.correct, is_correct: isCorrect })
    }
    const score = Math.round(correct / questions.length * 100)
    const res = { score, correct, total: questions.length, results: resultList }
    setResults(res)
    setSubmitted(true)
    setCurrentQ(0)
    setView('results')

    const sessionData = {
      timestamp: new Date().toISOString(),
      topic_id: selectedSources.size === 2 ? 'all' : [...selectedSources].join('+'),
      total: questions.length, correct, score,
      time_spent_seconds: elapsed,
    }

    const allSessions = loadSessions()
    allSessions.push(sessionData)
    saveSessions(allSessions)
    setSessions(allSessions)

    const updated = loadCorrectIds()
    const newIds = []
    for (const r of resultList) {
      if (r.is_correct) {
        updated.add(r.question_id)
        newIds.push(r.question_id)
      }
    }
    saveCorrectIds(updated)
    setCorrectIds(updated)

    syncToServer(newIds, sessionData)
  }

  function goHome() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setView('home')
    setQuestions([])
    setAnswers({})
    setSubmitted(false)
    setResults(null)
    setReviewMode(false)
    setRevealed({})
  }

  function formatTime(s) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  function reviewQuestion(questionId, action) {
    setReviewStatus(prev => {
      const updated = { ...prev, [questionId]: action }
      localStorage.setItem('audit_quiz_reviews', JSON.stringify(updated))
      return updated
    })
  }

  // Auth handlers
  async function handleAuth(e) {
    e.preventDefault()
    setAuthError(null)
    setAuthLoading(true)
    const endpoint = authMode === 'login' ? '/api/login' : '/api/register'
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.detail || 'შეცდომა')
        setAuthLoading(false)
        return
      }
      setAuth(data.token, data.username)
      setUser(data.username)
      setAuthForm({ username: '', password: '' })
      setView('home')
    } catch {
      setAuthError('სერვერთან დაკავშირება ვერ მოხერხდა')
    }
    setAuthLoading(false)
  }

  function handleLogout() {
    clearAuth()
    setUser(null)
    setView('home')
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="loading">
          <div className="spinner" />
          <p>იტვირთება...</p>
        </div>
      </div>
    )
  }

  const poolSize = getPool(true).length

  return (
    <div className="app-shell">
      <div className="app-header">
        <h1>აუდიტის სერტიფიცირება</h1>
        <div className="subtitle">გამოცდისთვის მომზადების პლატფორმა</div>
      </div>

      {error && <div className="error-msg">{error}<button onClick={() => setError(null)} style={{marginLeft:8,background:'none',border:'none',color:'inherit',cursor:'pointer'}}>✕</button></div>}

      {/* NAV */}
      {view !== 'quiz' && view !== 'cards' && view !== 'auth' && (
        <div className="tab-bar">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>
            <i className="ti ti-home" />მთავარი
          </button>
          <button className={view === 'progress' ? 'active' : ''} onClick={() => { setView('progress'); setSessions(loadSessions()) }}>
            <i className="ti ti-chart-bar" />პროგრესი
          </button>
          {user ? (
            <button className="user-chip" onClick={() => setView('account')}>
              <i className="ti ti-user" />{user}
            </button>
          ) : (
            <button className={view === 'auth' ? 'active' : ''} onClick={() => setView('auth')}>
              <i className="ti ti-login" />შესვლა
            </button>
          )}
        </div>
      )}

      {/* ====== AUTH ====== */}
      {view === 'auth' && (
        <div className="auth-section">
          <div className="auth-card">
            <div className="auth-tabs">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError(null) }}>
                შესვლა
              </button>
              <button className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setAuthError(null) }}>
                რეგისტრაცია
              </button>
            </div>

            <form onSubmit={handleAuth}>
              <div className="auth-field">
                <label>მომხმარებელი</label>
                <input
                  type="text"
                  value={authForm.username}
                  onChange={e => setAuthForm(f => ({ ...f, username: e.target.value }))}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="auth-field">
                <label>პაროლი</label>
                <input
                  type="password"
                  value={authForm.password}
                  onChange={e => setAuthForm(f => ({ ...f, password: e.target.value }))}
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  required
                />
              </div>

              {authError && <div className="auth-error">{authError}</div>}

              <button className="btn-start auth-submit" type="submit" disabled={authLoading}>
                {authLoading ? '...' : authMode === 'login' ? 'შესვლა' : 'რეგისტრაცია'}
              </button>
            </form>

            <button className="btn-ghost auth-back" onClick={() => setView('home')}>
              <i className="ti ti-arrow-left" />უკან
            </button>
          </div>
        </div>
      )}

      {/* ====== ACCOUNT ====== */}
      {view === 'account' && (
        <div className="auth-section">
          <div className="auth-card">
            <div className="account-header">
              <i className="ti ti-user-circle" style={{ fontSize: 48, color: 'var(--c-purple-tint)' }} />
              <h2>{user}</h2>
            </div>
            <div className="account-stats">
              <div className="account-stat">
                <div className="value">{correctIds.size}</div>
                <div className="label">სწორი კითხვა</div>
              </div>
              <div className="account-stat">
                <div className="value">{sessions.length}</div>
                <div className="label">ტესტი</div>
              </div>
            </div>
            <button className="btn-ghost logout-btn" onClick={handleLogout}>
              <i className="ti ti-logout" />გასვლა
            </button>
            <button className="btn-ghost auth-back" onClick={() => setView('home')}>
              <i className="ti ti-arrow-left" />უკან
            </button>
          </div>
        </div>
      )}

      {/* ====== HOME ====== */}
      {view === 'home' && (
        <>
          {bank.length === 0 ? (
            <div className="empty-state">
              <p>კითხვების ბანკი ცარიელია</p>
            </div>
          ) : (
            <>
              <div className="source-grid">
                <div
                  className={`source-card src-handbook ${selectedSources.has('handbook') ? 'selected' : ''}`}
                  onClick={() => toggleSource('handbook')}
                >
                  <div className="s-icon"><i className="ti ti-book-2" /></div>
                  <div className="s-body">
                    <div className="s-name">სახელმძღვანელო</div>
                    <div className="s-count">{handbookCount} კითხვა</div>
                    {handbookDone > 0 && <div className="s-done">{handbookDone} კითხვა ✓</div>}
                  </div>
                  <div className="s-check"><i className="ti ti-check" /></div>
                </div>
                <div
                  className={`source-card src-ai ${selectedSources.has('ai') ? 'selected' : ''}`}
                  onClick={() => toggleSource('ai')}
                >
                  <div className="s-icon"><i className="ti ti-sparkles" /></div>
                  <div className="s-body">
                    <div className="s-name">AI შეკითხვები</div>
                    <div className="s-count">{aiCount} კითხვა</div>
                    {aiDone > 0 && <div className="s-done">{aiDone} კითხვა ✓</div>}
                  </div>
                  <div className="s-check"><i className="ti ti-check" /></div>
                </div>
              </div>

              <div className="session-config">
                <div className="session-row">
                  <div className="k">სესიის ხანგრძლივობა</div>
                  <div className="v">{questionCount} კითხვა · ~{Math.round(questionCount * 0.7)} წთ</div>
                </div>
                <div className="stops">
                  {COUNT_STOPS.map(n => (
                    <div
                      key={n}
                      className={`stop ${questionCount === n ? 'active' : ''}`}
                      onClick={() => setQuestionCount(n)}
                    >
                      <div className="n">{n}</div>
                      <div className="t">~{Math.round(n * 0.7)} წთ</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="start-row">
                <div className="pool">ხელმისაწვდომი: <b>{poolSize.toLocaleString()} კითხვა</b></div>
                <div className="actions">
                  <button className="btn-start" onClick={startQuiz} disabled={poolSize === 0}>
                    <i className="ti ti-player-play" />ტესტი
                  </button>
                  <button className="btn-start-cards" onClick={startCards} disabled={getPool(false).length === 0}>
                    <i className="ti ti-cards" />ბარათები
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ====== QUIZ ====== */}
      {view === 'quiz' && questions.length > 0 && (() => {
        const q = questions[currentQ]
        const qId = q.id
        const isRevealed = revealed[qId] || reviewMode
        const explanations = q.explanations || {}
        const status = reviewStatus[qId] || (q.confirmed ? 'confirm' : q.needs_review ? 'flag' : null)
        return (
          <>
            <div className="test-top">
              <div className="crumb">
                <span className="chip">ტესტი</span>
                <span>{formatTime(elapsed)}</span>
              </div>
              <button className="btn-exit" onClick={goHome}>
                <i className="ti ti-x" />{reviewMode ? 'დახურვა' : 'გაუქმება'}
              </button>
            </div>

            <div className="q-bar">
              <span style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
            </div>
            <div className="q-meta">
              <span>კითხვა {currentQ + 1} / {questions.length}</span>
              {!reviewMode && Object.keys(revealed).length > 0 && (
                <span>სწორი {correctSoFar} · არასწორი {wrongSoFar}</span>
              )}
            </div>

            <div className="q-body">{q.question}</div>
            {q.english_summary && <div className="q-english">({q.english_summary})</div>}

            <div className="options">
              {Object.entries(q.options).map(([key, value]) => {
                let cls = 'opt'
                if (isRevealed) {
                  if (key === q.correct) cls += ' correct'
                  else if (key === answers[qId]) cls += ' wrong'
                } else if (answers[qId] === key) {
                  cls += ' selected'
                }
                return (
                  <div key={key}>
                    <button className={cls} onClick={() => selectAnswer(qId, key)} disabled={isRevealed}>
                      <div className="marker">
                        {isRevealed && key === q.correct
                          ? <i className="ti ti-check" style={{ fontSize: 15 }} />
                          : isRevealed && key === answers[qId] && key !== q.correct
                            ? <i className="ti ti-x" style={{ fontSize: 15 }} />
                            : key.toUpperCase()}
                      </div>
                      <div className="opt-text">{value}</div>
                    </button>
                    {isRevealed && explanations[key] && (
                      <div className={`explain-box ${key === q.correct ? 'correct-exp' : 'wrong-exp'}`}>
                        {explanations[key]}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="test-actions">
              {isRevealed && (
                <>
                  <button
                    className={`btn-ghost ${status === 'flag' ? 'flag-active' : ''}`}
                    onClick={() => reviewQuestion(qId, 'flag')}
                  >
                    <i className="ti ti-flag" />{status === 'flag' ? 'მონიშნული' : 'მონიშვნა'}
                  </button>
                  <button
                    className={`btn-ghost ${status === 'confirm' ? 'confirm-active' : ''}`}
                    onClick={() => reviewQuestion(qId, 'confirm')}
                  >
                    <i className="ti ti-check" />{status === 'confirm' ? 'დადასტურებული' : 'დადასტურება'}
                  </button>
                </>
              )}

              {currentQ > 0 && (
                <button className="btn-ghost" onClick={() => setCurrentQ(c => c - 1)}>
                  <i className="ti ti-arrow-left" />წინა
                </button>
              )}

              {currentQ < questions.length - 1 ? (
                <button className="btn-next" onClick={() => setCurrentQ(c => c + 1)} disabled={!revealed[qId] && !reviewMode}>
                  შემდეგი <i className="ti ti-arrow-right" />
                </button>
              ) : !reviewMode ? (
                <button className="btn-finish" onClick={submitQuiz} disabled={!revealed[qId]}>
                  <i className="ti ti-check" />დასრულება
                </button>
              ) : (
                <button className="btn-next" onClick={goHome}>
                  დახურვა <i className="ti ti-x" />
                </button>
              )}
            </div>
          </>
        )
      })()}

      {/* ====== CARDS ====== */}
      {view === 'cards' && cards.length > 0 && (() => {
        const card = cards[currentCard]
        const isOpen = card.type === 'open'
        const correctKey = card.correct
        const correctText = isOpen ? null : card.options?.[correctKey]
        const explanation = isOpen ? null : (card.explanations?.[correctKey] || '')
        const englishSummary = card.english_summary || ''
        const progress = ((currentCard + 1) / cards.length) * 100

        return (
          <>
            <div className="card-top">
              <div className="card-chip">
                <i className={isOpen ? 'ti ti-puzzle' : 'ti ti-cards'} />
                {isOpen ? 'ამოცანა' : 'ბარათი'}
              </div>
              <div className="card-ix">{currentCard + 1} / {cards.length}</div>
            </div>

            <div className="deck-bar"><span style={{ width: `${progress}%` }} /></div>

            <div className="flash-wrap">
              <div
                className={`flash ${isOpen ? 'open-card' : ''}`}
                onClick={() => !isOpen && setFlipped(f => !f)}
              >
                <div className="flash-topline">
                  <span>{isOpen ? 'დავალება' : (flipped ? 'პასუხი' : 'კითხვა')}</span>
                  {isOpen && <span className="flash-badge">Open-ended</span>}
                </div>

                {(!flipped || isOpen) && (
                  <div className="flash-question">{card.question}</div>
                )}

                {flipped && !isOpen && (
                  <>
                    <div className="flash-question" style={{ fontSize: 16, fontWeight: 400 }}>
                      {card.question}
                    </div>
                    <div className="flash-divider" />
                    {correctText && (
                      <div className="flash-section flash-answer">
                        <div className="flash-label">პასუხი</div>
                        {correctKey}) {correctText}
                      </div>
                    )}
                    {explanation && (
                      <div className="flash-section">
                        <div className="flash-label">ახსნა</div>
                        {explanation}
                      </div>
                    )}
                  </>
                )}

                {isOpen && englishSummary && (
                  <>
                    <div className="flash-divider" />
                    <div className="flash-section">
                      <div className="flash-label">Task</div>
                      {englishSummary}
                    </div>
                  </>
                )}

                {!isOpen && !flipped && englishSummary && (
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 8, fontStyle: 'italic' }}>
                    ({englishSummary})
                  </div>
                )}

                <div className="flash-footer">
                  {!isOpen && (
                    <span><i className="ti ti-hand-finger" />{flipped ? 'დააწექი დასაკეცად' : 'დააწექი გასაშლელად'}</span>
                  )}
                  <span style={{ marginLeft: 'auto' }}>{currentCard + 1} / {cards.length}</span>
                </div>
              </div>
            </div>

            <div className="card-nav">
              <button
                className="btn-ghost"
                onClick={() => { setCurrentCard(c => c - 1); setFlipped(false) }}
                disabled={currentCard === 0}
              >
                <i className="ti ti-arrow-left" />წინა
              </button>
              <div className="spacer" />
              <button className="btn-ghost" onClick={goHome}>
                <i className="ti ti-x" />დახურვა
              </button>
              <div className="spacer" />
              <button
                className="btn-ghost"
                onClick={() => { setCurrentCard(c => c + 1); setFlipped(false) }}
                disabled={currentCard === cards.length - 1}
              >
                შემდეგი<i className="ti ti-arrow-right" />
              </button>
            </div>
          </>
        )
      })()}

      {/* ====== RESULTS ====== */}
      {view === 'results' && results && (
        <div className="results-card">
          <h2>შედეგი</h2>
          <div className={`score-display ${results.score >= 70 ? 'good' : results.score >= 50 ? 'medium' : 'bad'}`}>
            {results.score}%
          </div>
          <p className="details">
            {results.correct} სწორი / {results.total} კითხვიდან · დრო: {formatTime(elapsed)}
          </p>
          <div className="results-actions">
            <button className="btn-ghost" onClick={() => { setReviewMode(true); setCurrentQ(0); setView('quiz') }}>
              <i className="ti ti-eye" />პასუხების ნახვა
            </button>
            <button className="btn-start" onClick={startQuiz}>
              <i className="ti ti-refresh" />ახალი ტესტი
            </button>
            <button className="btn-ghost" onClick={goHome}>
              <i className="ti ti-home" />მთავარი
            </button>
          </div>
        </div>
      )}

      {/* ====== PROGRESS ====== */}
      {view === 'progress' && (
        <div className="progress-section">
          <h2>სტატისტიკა</h2>
          {sessions.length > 0 ? (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="value">{sessions.length}</div>
                  <div className="label">ტესტი</div>
                </div>
                <div className="stat-card">
                  <div className="value">
                    {Math.round(
                      sessions.reduce((a, s) => a + s.correct, 0) /
                      sessions.reduce((a, s) => a + s.total, 0) * 100
                    )}%
                  </div>
                  <div className="label">საშუალო</div>
                </div>
                <div className="stat-card">
                  <div className="value">{correctIds.size}</div>
                  <div className="label">ათვისებული</div>
                </div>
              </div>

              <h2>ბოლო სესიები</h2>
              <div className="session-list">
                {[...sessions].reverse().slice(0, 20).map((s, i) => (
                  <div key={i} className="session-item">
                    <div className="session-info">
                      <span className="session-date">
                        {new Date(s.timestamp).toLocaleDateString('ka-GE')}
                      </span>
                      {' · '}
                      <span>{s.topic_id === 'all' ? 'ყველა' : s.topic_id}</span>
                    </div>
                    <span className="session-score" style={{ color: s.score >= 70 ? 'var(--ok)' : s.score >= 50 ? '#FAC775' : 'var(--bad)' }}>
                      {s.score}% ({s.correct}/{s.total})
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>ჯერ არ გაქვთ ჩაბარებული ტესტი</p>
              <button className="btn-start" onClick={() => setView('home')}>
                <i className="ti ti-player-play" />დაიწყე
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
