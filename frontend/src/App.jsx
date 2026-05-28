import { useState, useEffect, useRef } from 'react'
import './App.css'

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function loadProgress() {
  try {
    const data = localStorage.getItem('audit_quiz_progress')
    return data ? JSON.parse(data) : { sessions: [], topic_stats: {} }
  } catch {
    return { sessions: [], topic_stats: {} }
  }
}

function saveProgress(data) {
  localStorage.setItem('audit_quiz_progress', JSON.stringify(data))
}

function App() {
  const [view, setView] = useState('home')
  const [bank, setBank] = useState([])
  const [topics, setTopics] = useState([])
  const [selectedTopics, setSelectedTopics] = useState(new Set())
  const [questionCount, setQuestionCount] = useState(10)
  const [questions, setQuestions] = useState([])
  const [currentQ, setCurrentQ] = useState(0)
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults] = useState(null)
  const [progress, setProgress] = useState(loadProgress())
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

  useEffect(() => {
    fetch('./question_bank.json')
      .then(res => res.json())
      .then(data => {
        setBank(data)
        const byTopic = {}
        for (const q of data) {
          const t = q.topic || 'ზოგადი'
          if (!byTopic[t]) byTopic[t] = 0
          byTopic[t]++
        }
        setTopics(
          Object.entries(byTopic)
            .sort(([a], [b]) => {
              // "შუალედური გამოცდა" always first
              if (a === 'შუალედური გამოცდა') return -1
              if (b === 'შუალედური გამოცდა') return 1
              return a.localeCompare(b)
            })
            .map(([name, count]) => ({ id: name, name, question_count: count }))
        )
        setLoading(false)
      })
      .catch(() => {
        setError('კითხვების ბანკის ჩატვირთვა ვერ მოხერხდა')
        setLoading(false)
      })
  }, [])

  function toggleTopic(topicId) {
    setSelectedTopics(prev => {
      const next = new Set(prev)
      if (topicId === null) {
        // "All topics" — clear selection
        return new Set()
      }
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }

  const CARD_COLORS = [
    '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
    '#3498db', '#9b59b6', '#e84393', '#00b894', '#6c5ce7',
    '#fd79a8', '#00cec9', '#d63031', '#0984e3', '#a29bfe',
  ]

  function startCards() {
    let selected
    if (selectedTopics.size === 0) {
      selected = shuffleArray(bank).slice(0, questionCount)
    } else if (selectedTopics.size === 1) {
      selected = shuffleArray(bank.filter(q => selectedTopics.has(q.topic))).slice(0, questionCount)
    } else {
      const topicArr = [...selectedTopics]
      const perTopic = Math.floor(questionCount / topicArr.length)
      const remainder = questionCount % topicArr.length
      let picks = []
      for (let i = 0; i < topicArr.length; i++) {
        const pool = shuffleArray(bank.filter(q => q.topic === topicArr[i]))
        const take = perTopic + (i < remainder ? 1 : 0)
        picks.push(...pool.slice(0, take))
      }
      selected = shuffleArray(picks)
    }
    if (!selected.length) {
      setError('კითხვები ვერ მოიძებნა')
      return
    }
    setCards(selected)
    setCurrentCard(0)
    setView('cards')
  }

  function startQuiz() {
    let selected
    if (selectedTopics.size === 0) {
      // All topics
      const pool = shuffleArray(bank)
      selected = pool.slice(0, questionCount)
    } else if (selectedTopics.size === 1) {
      // Single topic
      const pool = shuffleArray(bank.filter(q => selectedTopics.has(q.topic)))
      selected = pool.slice(0, questionCount)
    } else {
      // Multi-topic: sample equally from each
      const topicArr = [...selectedTopics]
      const perTopic = Math.floor(questionCount / topicArr.length)
      const remainder = questionCount % topicArr.length
      let picks = []
      for (let i = 0; i < topicArr.length; i++) {
        const pool = shuffleArray(bank.filter(q => q.topic === topicArr[i]))
        const take = perTopic + (i < remainder ? 1 : 0)
        picks.push(...pool.slice(0, take))
      }
      selected = shuffleArray(picks)
    }
    if (!selected.length) {
      setError('კითხვები ვერ მოიძებნა')
      return
    }
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

  function selectAnswer(questionId, option) {
    if (revealed[questionId]) return
    setAnswers(prev => ({ ...prev, [questionId]: option }))
    setRevealed(prev => ({ ...prev, [questionId]: true }))
  }

  function submitQuiz() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    let correct = 0
    const resultList = []
    for (const q of questions) {
      const userAnswer = answers[q.id]
      const isCorrect = userAnswer === q.correct
      if (isCorrect) correct++
      resultList.push({
        question_id: q.id,
        user_answer: userAnswer,
        correct_answer: q.correct,
        is_correct: isCorrect,
      })
    }

    const score = Math.round(correct / questions.length * 100)
    const res = { score, correct, total: questions.length, results: resultList }
    setResults(res)
    setSubmitted(true)
    setCurrentQ(0)
    setView('results')

    const p = loadProgress()
    const session = {
      timestamp: new Date().toISOString(),
      topic_id: selectedTopics.size === 0 ? 'all' : [...selectedTopics].join(' + '),
      total: questions.length,
      correct,
      score,
      time_spent_seconds: elapsed,
    }
    p.sessions.push(session)
    const topic = selectedTopics.size === 0 ? 'all' : [...selectedTopics].join(' + ')
    if (!p.topic_stats[topic]) {
      p.topic_stats[topic] = { attempts: 0, total_questions: 0, total_correct: 0 }
    }
    p.topic_stats[topic].attempts += 1
    p.topic_stats[topic].total_questions += questions.length
    p.topic_stats[topic].total_correct += correct
    saveProgress(p)
    setProgress(p)
  }

  function goHome() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
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

  function getTopicStats(topicId) {
    return progress?.topic_stats?.[topicId || 'all'] || null
  }

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner" />
          <p>იტვირთება...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="header">
        <h1>აუდიტის სერტიფიცირება</h1>
        <p>გამოცდისთვის მომზადების პლატფორმა — {bank.length} კითხვა</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {view !== 'quiz' && view !== 'cards' && (
        <div className="nav">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>
            თემები
          </button>
          <button className={view === 'progress' ? 'active' : ''} onClick={() => { setView('progress'); setProgress(loadProgress()) }}>
            პროგრესი
          </button>
        </div>
      )}

      {/* HOME: Topic Selection */}
      {view === 'home' && (
        <>
          {bank.length === 0 ? (
            <div className="setup-card">
              <h2>კითხვების ბანკი ცარიელია</h2>
              <p>question_bank.json ფაილი ვერ მოიძებნა ან ცარიელია</p>
            </div>
          ) : (
            <>
              <div className="quiz-controls">
                <label>რაოდენობა:</label>
                <select value={questionCount} onChange={e => setQuestionCount(Number(e.target.value))}>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={60}>60</option>
                </select>
                <button className="btn btn-primary" onClick={startQuiz}>
                  ტესტის დაწყება
                </button>
                <button className="btn btn-cards" onClick={startCards}>
                  ბარათები
                </button>
              </div>

              <div className="topics">
                <div
                  className={`topic-card ${selectedTopics.size === 0 ? 'selected' : ''}`}
                  onClick={() => toggleTopic(null)}
                >
                  <div>
                    <h3>ყველა თემა</h3>
                    <span className="chunk-count">შერეული კითხვები ყველა თემიდან</span>
                  </div>
                  {getTopicStats('all') && (
                    <div className="stats">
                      <div className="score" style={{ color: getTopicStats('all').total_correct / getTopicStats('all').total_questions >= 0.7 ? '#22c55e' : '#fbbf24' }}>
                        {Math.round(getTopicStats('all').total_correct / getTopicStats('all').total_questions * 100)}%
                      </div>
                    </div>
                  )}
                </div>

                {topics.map(topic => {
                  const stats = getTopicStats(topic.id)
                  return (
                    <div
                      key={topic.id}
                      className={`topic-card ${selectedTopics.has(topic.id) ? 'selected' : ''}`}
                      onClick={() => toggleTopic(topic.id)}
                    >
                      <div>
                        <h3>{topic.name}</h3>
                        <span className="chunk-count">{topic.question_count} კითხვა</span>
                      </div>
                      {stats && (
                        <div className="stats">
                          <div className="score" style={{ color: stats.total_correct / stats.total_questions >= 0.7 ? '#22c55e' : '#fbbf24' }}>
                            {Math.round(stats.total_correct / stats.total_questions * 100)}%
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* QUIZ */}
      {view === 'quiz' && questions.length > 0 && (
        <>
          <div className="quiz-header">
            <span className="counter">
              {currentQ + 1} / {questions.length}
            </span>
            <span className="timer">{formatTime(elapsed)}</span>
          </div>

          <div className="question-card">
            <h3>{questions[currentQ].question}</h3>
            {questions[currentQ].english_summary && (
              <p className="english-summary">({questions[currentQ].english_summary})</p>
            )}
            <div className="options">
              {Object.entries(questions[currentQ].options).map(([key, value]) => {
                let className = 'option'
                const qId = questions[currentQ].id
                const explanations = questions[currentQ].explanations || {}
                const isRevealed = revealed[qId]

                if (isRevealed || reviewMode) {
                  if (key === questions[currentQ].correct) className += ' correct'
                  else if (key === answers[qId]) className += ' wrong'
                } else if (answers[qId] === key) {
                  className += ' selected'
                }

                return (
                  <div key={key}>
                    <button
                      className={className}
                      onClick={() => selectAnswer(qId, key)}
                      disabled={isRevealed || reviewMode}
                    >
                      <strong>{key})</strong> {value}
                    </button>
                    {(isRevealed || reviewMode) && explanations[key] && (
                      <div className={`option-explanation ${key === questions[currentQ].correct ? 'correct-exp' : 'wrong-exp'}`}>
                        {explanations[key]}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {(revealed[questions[currentQ].id] || reviewMode) && (
              <div className="review-actions">
                {(() => {
                  const qId = questions[currentQ].id
                  const status = reviewStatus[qId] || (questions[currentQ].confirmed ? 'confirm' : questions[currentQ].needs_review ? 'flag' : null)
                  return (
                    <>
                      <button
                        className={`btn-review btn-flag ${status === 'flag' ? 'active' : ''}`}
                        onClick={() => reviewQuestion(qId, 'flag')}
                      >
                        {status === 'flag' ? '⚠ მონიშნული' : '⚠ მონიშვნა'}
                      </button>
                      <button
                        className={`btn-review btn-confirm ${status === 'confirm' ? 'active' : ''}`}
                        onClick={() => reviewQuestion(qId, 'confirm')}
                      >
                        {status === 'confirm' ? '✓ დადასტურებული' : '✓ დადასტურება'}
                      </button>
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          <div className="quiz-nav">
            <button
              className="btn btn-secondary"
              onClick={() => setCurrentQ(q => q - 1)}
              disabled={currentQ === 0}
            >
              წინა
            </button>

            {!reviewMode && (
              <button className="btn btn-secondary" onClick={goHome}>
                გაუქმება
              </button>
            )}

            {reviewMode && (
              <button className="btn btn-secondary" onClick={goHome}>
                მთავარი
              </button>
            )}

            {currentQ < questions.length - 1 ? (
              <button
                className="btn btn-primary"
                onClick={() => setCurrentQ(q => q + 1)}
                disabled={!revealed[questions[currentQ].id]}
              >
                შემდეგი
              </button>
            ) : !reviewMode ? (
              <button
                className="btn btn-success"
                onClick={submitQuiz}
                disabled={!revealed[questions[currentQ].id]}
              >
                დასრულება
              </button>
            ) : (
              <button className="btn btn-primary" onClick={goHome}>
                დასრულება
              </button>
            )}
          </div>
        </>
      )}

      {/* CARDS */}
      {view === 'cards' && cards.length > 0 && (() => {
        const card = cards[currentCard]
        const color = CARD_COLORS[currentCard % CARD_COLORS.length]
        const correctKey = card.correct
        const correctText = card.options[correctKey]
        const explanation = card.explanations?.[correctKey] || ''
        const englishSummary = card.english_summary || ''
        return (
          <>
            <div className="cards-header">
              <span className="counter">{currentCard + 1} / {cards.length}</span>
              <button className="btn btn-secondary" onClick={goHome}>მთავარი</button>
            </div>

            <div className="flashcard" style={{ background: color }}>
              <div className="flashcard-question">{card.question}</div>
              <div className="flashcard-divider" />
              <div className="flashcard-answer">
                <span className="flashcard-label">პასუხი:</span>
                <span>{correctKey}) {correctText}</span>
              </div>
              {explanation && (
                <div className="flashcard-explanation">
                  <span className="flashcard-label">ახსნა:</span>
                  <span>{explanation}</span>
                </div>
              )}
              {englishSummary && (
                <div className="flashcard-english">
                  <span className="flashcard-label">English:</span>
                  <span>{englishSummary}</span>
                </div>
              )}
            </div>

            <div className="quiz-nav">
              <button
                className="btn btn-secondary"
                onClick={() => setCurrentCard(c => c - 1)}
                disabled={currentCard === 0}
              >
                წინა
              </button>
              <span className="cards-progress-dots">
                {cards.map((_, i) => (
                  <span
                    key={i}
                    className={`dot ${i === currentCard ? 'active' : ''}`}
                    style={{ background: i === currentCard ? CARD_COLORS[i % CARD_COLORS.length] : '#475569' }}
                    onClick={() => setCurrentCard(i)}
                  />
                ))}
              </span>
              <button
                className="btn btn-secondary"
                onClick={() => setCurrentCard(c => c + 1)}
                disabled={currentCard === cards.length - 1}
              >
                შემდეგი
              </button>
            </div>
          </>
        )
      })()}

      {/* RESULTS */}
      {view === 'results' && results && (
        <div className="results-card">
          <h2>შედეგი</h2>
          <div className={`score-display ${results.score >= 70 ? 'good' : results.score >= 50 ? 'medium' : 'bad'}`}>
            {results.score}%
          </div>
          <p className="details">
            {results.correct} სწორი / {results.total} კითხვიდან | დრო: {formatTime(elapsed)}
          </p>
          <div className="results-actions">
            <button className="btn btn-secondary" onClick={() => {
              setReviewMode(true)
              setCurrentQ(0)
              setView('quiz')
            }}>
              პასუხების ნახვა
            </button>
            <button className="btn btn-primary" onClick={startQuiz}>
              ახალი ტესტი
            </button>
            <button className="btn btn-secondary" onClick={goHome}>
              მთავარი
            </button>
          </div>
        </div>
      )}

      {/* PROGRESS */}
      {view === 'progress' && (
        <div className="progress-section">
          <h2>სტატისტიკა</h2>
          {progress && progress.sessions.length > 0 ? (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="value">{progress.sessions.length}</div>
                  <div className="label">ტესტი ჩაბარებული</div>
                </div>
                <div className="stat-card">
                  <div className="value">
                    {Math.round(
                      progress.sessions.reduce((a, s) => a + s.correct, 0) /
                      progress.sessions.reduce((a, s) => a + s.total, 0) * 100
                    )}%
                  </div>
                  <div className="label">საშუალო ქულა</div>
                </div>
                <div className="stat-card">
                  <div className="value">
                    {progress.sessions.reduce((a, s) => a + s.total, 0)}
                  </div>
                  <div className="label">კითხვა სულ</div>
                </div>
              </div>

              <h2>ბოლო სესიები</h2>
              <div className="session-list">
                {[...progress.sessions].reverse().slice(0, 20).map((s, i) => (
                  <div key={i} className="session-item">
                    <div>
                      <span className="session-date">
                        {new Date(s.timestamp).toLocaleDateString('ka-GE')}
                      </span>
                      {' | '}
                      <span>{s.topic_id === 'all' ? 'ყველა თემა' : s.topic_id}</span>
                    </div>
                    <span className="session-score" style={{ color: s.score >= 70 ? '#22c55e' : s.score >= 50 ? '#fbbf24' : '#ef4444' }}>
                      {s.score}% ({s.correct}/{s.total})
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="setup-card">
              <p>ჯერ არ გაქვთ ჩაბარებული ტესტი</p>
              <button className="btn btn-primary" onClick={() => setView('home')} style={{ marginTop: '1rem' }}>
                ტესტის დაწყება
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
