import { useState, useEffect, useRef, useCallback } from 'react'
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

// --- Speech helpers ---
const OPTION_KEYS = ['ა', 'ბ', 'გ', 'დ']
const VOICE_MAP = { a: 'ა', b: 'ბ', c: 'გ', d: 'დ', '1': 'ა', '2': 'ბ', '3': 'გ', '4': 'დ' }

// --- TTS: simple queue-based approach for iOS Safari compatibility ---
const speechQueue = []
let isSpeaking = false

function speak(text) {
  return new Promise(resolve => {
    const synth = window.speechSynthesis
    if (!synth) { resolve(); return }

    // Queue the utterance
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ka-GE'
    u.rate = 0.9
    u.onend = () => { isSpeaking = false; processQueue(); resolve() }
    u.onerror = () => { isSpeaking = false; processQueue(); resolve() }

    speechQueue.push(u)
    processQueue()
  })
}

function processQueue() {
  if (isSpeaking || !speechQueue.length) return
  const synth = window.speechSynthesis
  if (!synth) return
  isSpeaking = true
  const u = speechQueue.shift()
  synth.speak(u)
}

function stopSpeaking() {
  speechQueue.length = 0
  isSpeaking = false
  if (window.speechSynthesis) window.speechSynthesis.cancel()
}

function getSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return null
  const r = new SR()
  r.lang = 'en-US' // listen for a, b, c, d in English
  r.continuous = false
  r.interimResults = false
  r.maxAlternatives = 5
  return r
}

function App() {
  const [view, setView] = useState('home')
  const [bank, setBank] = useState([])
  const [topics, setTopics] = useState([])
  const [selectedTopic, setSelectedTopic] = useState(null)
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

  // Hands-free mode
  const [handsFree, setHandsFree] = useState(false)
  const [listening, setListening] = useState(false)
  const handsFreeRef = useRef(false)
  const recognitionRef = useRef(null)
  const abortRef = useRef(false)

  // Keep ref in sync
  useEffect(() => { handsFreeRef.current = handsFree }, [handsFree])

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
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, count]) => ({ id: name, name, question_count: count }))
        )
        setLoading(false)
      })
      .catch(() => {
        setError('კითხვების ბანკის ჩატვირთვა ვერ მოხერხდა')
        setLoading(false)
      })
  }, [])

  // --- Hands-free flow for current question ---
  const runHandsFreeQuestion = useCallback(async (q, qIndex, allQuestions, currentAnswers, currentRevealed) => {
    if (!handsFreeRef.current || abortRef.current) return

    // Read question number
    await speak(`კითხვა ${qIndex + 1}. ${q.question}`)
    if (!handsFreeRef.current || abortRef.current) return

    // Read options
    for (const [key, value] of Object.entries(q.options)) {
      if (!handsFreeRef.current || abortRef.current) return
      await speak(`${key}. ${value}`)
    }

    if (!handsFreeRef.current || abortRef.current) return

    // Already answered? Skip listening
    if (currentRevealed[q.id]) {
      await speak('უკვე პასუხგაცემული')
      return
    }

    // Listen for answer
    await speak('თქვენი პასუხი?')
    if (!handsFreeRef.current || abortRef.current) return

    const answer = await listenForAnswer()
    if (!handsFreeRef.current || abortRef.current) return

    if (answer && OPTION_KEYS.includes(answer)) {
      // Process answer
      const isCorrect = answer === q.correct
      // We return the answer to be processed by the caller
      return { answer, isCorrect }
    } else {
      await speak('ვერ გავიგე. თავიდან სცადეთ.')
      if (!handsFreeRef.current || abortRef.current) return
      // Retry
      return runHandsFreeQuestion(q, qIndex, allQuestions, currentAnswers, currentRevealed)
    }
  }, [])

  function listenForAnswer() {
    return new Promise(resolve => {
      const rec = getSpeechRecognition()
      if (!rec) {
        resolve(null)
        return
      }
      recognitionRef.current = rec
      setListening(true)

      let resolved = false

      rec.onresult = (e) => {
        resolved = true
        setListening(false)
        // Check all alternatives for a match
        for (let i = 0; i < e.results[0].length; i++) {
          const transcript = e.results[0][i].transcript.trim().toLowerCase()
          // Match single letter or Georgian letter
          for (const [eng, geo] of Object.entries(VOICE_MAP)) {
            if (transcript === eng || transcript.startsWith(eng + ' ') || transcript === geo) {
              resolve(geo)
              return
            }
          }
        }
        resolve(null)
      }

      rec.onerror = () => {
        if (!resolved) { resolved = true; setListening(false); resolve(null) }
      }
      rec.onend = () => {
        if (!resolved) { resolved = true; setListening(false); resolve(null) }
      }

      rec.start()

      // Timeout after 8 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          try { rec.stop() } catch {}
          setListening(false)
          resolve(null)
        }
      }, 8000)
    })
  }

  function startQuiz() {
    let pool = bank
    if (selectedTopic && selectedTopic !== 'all') {
      pool = bank.filter(q => q.topic === selectedTopic)
    }
    if (!pool.length) {
      setError('კითხვები ვერ მოიძებნა')
      return
    }
    const selected = shuffleArray(pool).slice(0, questionCount)
    setQuestions(selected)
    setCurrentQ(0)
    setAnswers({})
    setSubmitted(false)
    setResults(null)
    setElapsed(0)
    setReviewMode(false)
    setRevealed({})
    abortRef.current = false
    setView('quiz')
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }

  function selectAnswer(questionId, option) {
    if (revealed[questionId]) return
    setAnswers(prev => ({ ...prev, [questionId]: option }))
    setRevealed(prev => ({ ...prev, [questionId]: true }))
  }

  // Hands-free: process answer and auto-advance
  const handsFreeAnswer = useCallback(async (questionId, option, isCorrect, q, qIndex, allQuestions) => {
    selectAnswer(questionId, option)

    // Voice feedback
    if (isCorrect) {
      await speak('სწორია!')
    } else {
      const correctKey = q.correct
      const correctText = q.options[correctKey]
      await speak(`არასწორია. სწორი პასუხია ${correctKey}. ${correctText}`)
    }

    if (!handsFreeRef.current || abortRef.current) return

    // Read explanation for correct answer
    const explanations = q.explanations || {}
    if (explanations[q.correct]) {
      await speak(explanations[q.correct])
    }

    if (!handsFreeRef.current || abortRef.current) return

    // Pause, then advance
    await new Promise(r => setTimeout(r, 1500))

    if (!handsFreeRef.current || abortRef.current) return

    if (qIndex < allQuestions.length - 1) {
      setCurrentQ(qIndex + 1)
    } else {
      // Quiz finished — submit
      await speak('ტესტი დასრულდა.')
    }
  }, [])

  // Trigger hands-free reading when question changes
  useEffect(() => {
    if (!handsFree || view !== 'quiz' || reviewMode || !questions.length) return

    const q = questions[currentQ]
    if (!q || revealed[q.id]) return

    let cancelled = false
    abortRef.current = false

    ;(async () => {
      const result = await runHandsFreeQuestion(q, currentQ, questions, answers, revealed)
      if (cancelled || !handsFreeRef.current) return

      if (result?.answer) {
        await handsFreeAnswer(q.id, result.answer, result.isCorrect, q, currentQ, questions)
      }
    })()

    return () => { cancelled = true; abortRef.current = true }
  }, [handsFree, currentQ, view, reviewMode, questions])

  function toggleHandsFree() {
    if (handsFree) {
      // Turn off
      stopSpeaking()
      if (recognitionRef.current) try { recognitionRef.current.stop() } catch {}
      abortRef.current = true
      setListening(false)
      setHandsFree(false)
    } else {
      // Check if TTS is available
      const synth = window.speechSynthesis
      if (!synth) {
        setError('ხმოვანი რეჟიმი არ არის ხელმისაწვდომი ამ ბრაუზერში')
        return
      }
      // iOS REQUIRES speak() in the direct tap handler call stack.
      // This "unlocks" audio for all subsequent speaks.
      const u = new SpeechSynthesisUtterance('ხმოვანი რეჟიმი ჩართულია')
      u.lang = 'ka-GE'
      u.rate = 0.9
      synth.speak(u)
      setHandsFree(true)
    }
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
      topic_id: selectedTopic || 'all',
      total: questions.length,
      correct,
      score,
      time_spent_seconds: elapsed,
    }
    p.sessions.push(session)
    const topic = selectedTopic || 'all'
    if (!p.topic_stats[topic]) {
      p.topic_stats[topic] = { attempts: 0, total_questions: 0, total_correct: 0 }
    }
    p.topic_stats[topic].attempts += 1
    p.topic_stats[topic].total_questions += questions.length
    p.topic_stats[topic].total_correct += correct
    saveProgress(p)
    setProgress(p)

    if (handsFree) {
      speak(`შედეგი: ${score} პროცენტი. ${correct} სწორი ${questions.length} კითხვიდან.`)
    }
  }

  function goHome() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    stopSpeaking()
    if (recognitionRef.current) try { recognitionRef.current.stop() } catch {}
    abortRef.current = true
    setView('home')
    setQuestions([])
    setAnswers({})
    setSubmitted(false)
    setResults(null)
    setReviewMode(false)
    setRevealed({})
    setListening(false)
  }

  function formatTime(s) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
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

      {view !== 'quiz' && (
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
              <div className="topics">
                <div
                  className={`topic-card ${selectedTopic === null ? 'selected' : ''}`}
                  onClick={() => setSelectedTopic(null)}
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
                      className={`topic-card ${selectedTopic === topic.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTopic(topic.id)}
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

              <div className="quiz-controls">
                <label>კითხვების რაოდენობა:</label>
                <select value={questionCount} onChange={e => setQuestionCount(Number(e.target.value))}>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
                <button className="btn btn-primary" onClick={startQuiz}>
                  ტესტის დაწყება
                </button>
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
            <button
              className={`btn-icon hands-free-btn ${handsFree ? 'active' : ''}`}
              onClick={toggleHandsFree}
              title={handsFree ? 'გამორთე ხმოვანი რეჟიმი' : 'ჩართე ხმოვანი რეჟიმი'}
            >
              {handsFree ? (listening ? '🎤' : '🔊') : '🎧'}
            </button>
            <span className="timer">{formatTime(elapsed)}</span>
          </div>

          {handsFree && (
            <div className="hands-free-banner">
              {listening ? '🎤 მოგისმენთ... თქვით: A, B, C ან D' : '🔊 ხმოვანი რეჟიმი ჩართულია'}
            </div>
          )}

          <div className="question-card">
            <h3>{questions[currentQ].question}</h3>
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
