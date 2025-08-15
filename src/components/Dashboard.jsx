import React, { useState, useEffect, useCallback } from 'react'
import { fetchIdeas, fetchMySubmissions, submitIdea, submitFeedback } from '../lib/supabase'
import { evaluateIdea, evaluateFeedback } from '../lib/openai'

const CATEGORIES = [
  'Technology', 'Healthcare', 'Education', 'Environment', 'Finance',
  'Social Impact', 'Entertainment', 'Food & Beverage', 'Transportation', 'Other'
]

const HEAR_ABOUT_OPTIONS = [
  'Social Media', 'Friend/Family', 'Online Search', 'News Article', 
  'Podcast', 'Conference/Event', 'Advertisement', 'Other'
]

const REFRESH_INTERVAL = 30000 // 30 seconds

function Dashboard() {
  const [ideas, setIdeas] = useState([])
  const [mySubmissions, setMySubmissions] = useState([])
  const [selectedIdea, setSelectedIdea] = useState(null)
  const [refreshTimer, setRefreshTimer] = useState(REFRESH_INTERVAL / 1000)
  
  // Form states
  const [formData, setFormData] = useState({
    full_name: '',
    who_to_serve: '',
    product_idea: '',
    categories: [],
    source: '',
    other_source: ''
  })
  
  const [feedbackData, setFeedbackData] = useState({
    feedback_text: '',
    contact_info: ''
  })
  
  const [messages, setMessages] = useState({ idea: '', feedback: '' })
  const [loading, setLoading] = useState({ idea: false, feedback: false })
  const [lastSubmissionTime, setLastSubmissionTime] = useState(0)

  // Load saved form data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('antithesis_form_data')
    if (saved) {
      try {
        setFormData(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to load saved form data:', e)
      }
    }
    
    const savedFeedback = localStorage.getItem('antithesis_feedback_data')
    if (savedFeedback) {
      try {
        setFeedbackData(JSON.parse(savedFeedback))
      } catch (e) {
        console.error('Failed to load saved feedback data:', e)
      }
    }
    
    const lastSubmit = localStorage.getItem('last_submission_time')
    if (lastSubmit) {
      setLastSubmissionTime(parseInt(lastSubmit))
    }
  }, [])

  // Save form data to localStorage
  useEffect(() => {
    localStorage.setItem('antithesis_form_data', JSON.stringify(formData))
  }, [formData])

  useEffect(() => {
    localStorage.setItem('antithesis_feedback_data', JSON.stringify(feedbackData))
  }, [feedbackData])

  // Load data on mount and set up refresh timer
  useEffect(() => {
    loadData()
    
    const interval = setInterval(() => {
      setRefreshTimer(prev => {
        if (prev <= 1) {
          loadData()
          return REFRESH_INTERVAL / 1000
        }
        return prev - 1
      })
    }, 1000)
    
    return () => clearInterval(interval)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [ideasData, submissionsData] = await Promise.all([
        fetchIdeas(),
        fetchMySubmissions()
      ])
      setIdeas(ideasData)
      setMySubmissions(submissionsData)
    } catch (error) {
      console.error('Failed to load data:', error)
    }
  }, [])

  const showMessage = (type, message, duration = 5000) => {
    setMessages(prev => ({ ...prev, [type]: message }))
    setTimeout(() => {
      setMessages(prev => ({ ...prev, [type]: '' }))
    }, duration)
  }

  const handleFormChange = (field, value) => {
    if (field === 'categories') {
      const newCategories = formData.categories.includes(value)
        ? formData.categories.filter(cat => cat !== value)
        : [...formData.categories, value]
      setFormData(prev => ({ ...prev, categories: newCategories }))
    } else {
      setFormData(prev => ({ ...prev, [field]: value }))
    }
  }

  const getWordCount = (text) => {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length
  }

  const canSubmitIdea = () => {
    const now = Date.now()
    const timeSinceLastSubmission = now - lastSubmissionTime
    return timeSinceLastSubmission >= 60000 // 1 minute
  }

  const handleIdeaSubmit = async (e) => {
    e.preventDefault()
    
    if (!canSubmitIdea()) {
      const remaining = Math.ceil((60000 - (Date.now() - lastSubmissionTime)) / 1000)
      showMessage('idea', `Please wait ${remaining} seconds before submitting again`, 3000)
      return
    }
    
    // Check minimum word counts
    const whoToServeWords = getWordCount(formData.who_to_serve)
    const productIdeaWords = getWordCount(formData.product_idea)
    
    if (whoToServeWords < 10) {
      showMessage('idea', 'Who You Serve must be at least 10 words', 3000)
      return
    }
    
    if (productIdeaWords < 25) {
      showMessage('idea', 'Product Idea must be at least 25 words', 3000)
      return
    }
    
    if (getWordCount(formData.who_to_serve) > 50) {
      showMessage('idea', 'Who You Serve must be 50 words or less', 3000)
      return
    }
    
    if (getWordCount(formData.product_idea) > 150) {
      showMessage('idea', 'Product Idea must be 150 words or less', 3000)
      return
    }

    setLoading(prev => ({ ...prev, idea: true }))
    
    try {
      // Step 1: Check for local duplicates against My Submissions
      console.log('Step 1: Checking for local duplicates against My Submissions...')
      const newProductIdea = formData.product_idea.toLowerCase().trim()
      
      for (const submission of mySubmissions) {
        const existingIdea = submission.product_idea.toLowerCase().trim()
        if (newProductIdea === existingIdea) {
          console.log('Local Duplicate Detection: Exact match found in My Submissions')
          showMessage('idea', 'You have already submitted this exact idea. Please submit something new.', 5000)
          setLoading(prev => ({ ...prev, idea: false }))
          return
        }
      }

      // Step 2: OpenAI content validation
      console.log('Step 2: Starting OpenAI content validation...')
      const evaluation = await evaluateIdea(
        formData.product_idea,
        formData.full_name,
        formData.who_to_serve
      )

      const submissionData = {
        full_name: formData.full_name,
        who_to_serve: formData.who_to_serve,
        product_idea: formData.product_idea,
        categories: formData.categories,
        source: formData.source === 'Other' ? formData.other_source : formData.source,
        visible: evaluation.visible,
        rejection_reason: evaluation.rejection_reason,
        rough_score: evaluation.rough_score
      }

      if (!evaluation.approved) {
        const reason = evaluation.rejection_reason.toLowerCase()
        let ruleTriggered = 'Unknown rule'
        let errorMessage = 'Submission rejected: '
        
        // Log which specific rule was triggered
        if (reason.includes('spam') || reason.includes('junk') || reason.includes('random') || reason.includes('unrelated')) {
          ruleTriggered = 'Rule 1: Spam/junk content'
          errorMessage += 'Content appears to be spam, junk, or unrelated text'
        } else if (reason.includes('contact') || reason.includes('personal') || reason.includes('phone') || reason.includes('email') || reason.includes('address')) {
          ruleTriggered = 'Rule 2: Personal contact information'
          errorMessage += 'Personal contact information is not allowed (phone numbers, emails, addresses, social handles)'
        } else if (reason.includes('malicious') || reason.includes('hate') || reason.includes('harassment') || reason.includes('sexual') || reason.includes('harm')) {
          ruleTriggered = 'Rule 3: Malicious content'
          errorMessage += 'Content violates community guidelines (hate speech, harassment, inappropriate sexual content, or dangerous activity)'
        } else if (reason.includes('link') || reason.includes('url') || reason.includes('irrelevant') || reason.includes('harmful')) {
          ruleTriggered = 'Rule 4: Irrelevant/harmful links'
          errorMessage += 'Links to irrelevant or harmful content are not allowed'
        } else if (reason.includes('empty') || reason.includes('meaningful') || reason.includes('words') || reason.includes('content')) {
          ruleTriggered = 'Rule 5: Empty/near-empty content'
          errorMessage += 'Please provide more meaningful content (less than 3 meaningful words detected)'
        } else {
          errorMessage += evaluation.rejection_reason
        }
        
        console.log(`OpenAI Content Rejection: ${ruleTriggered} - ${evaluation.rejection_reason}`)
        showMessage('idea', errorMessage, 8000)
        setLoading(prev => ({ ...prev, idea: false }))
        return
      }

      // Step 3: Submit to database
      console.log('Step 3: Submitting to database...')
      const result = await submitIdea(submissionData)
      
      setLastSubmissionTime(Date.now())
      localStorage.setItem('last_submission_time', Date.now().toString())
      
      // Clear form
      setFormData({
        full_name: '',
        who_to_serve: '',
        product_idea: '',
        categories: [],
        source: '',
        other_source: ''
      })
      localStorage.removeItem('antithesis_form_data')
      
      showMessage('idea', `Idea submitted successfully! Quality score: ${evaluation.rough_score}/100`, 5000)
      console.log('System Success: Idea submitted successfully with score', evaluation.rough_score, result)
      
      // Reload data
      loadData()
      
    } catch (error) {
      console.error('System Error: Failed to submit idea', error)
      
      if (error.message.includes('security policy')) {
        console.log('RLS Policy Decline: Access denied by security policy')
        showMessage('idea', 'Access denied by security policy', 5000)
      } else {
        showMessage('idea', `Error: ${error.message}`, 5000)
      }
    } finally {
      setLoading(prev => ({ ...prev, idea: false }))
    }
  }

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault()
    
    // Check minimum word count
    if (getWordCount(feedbackData.feedback_text) < 15) {
      showMessage('feedback', 'Feedback must be at least 15 words', 3000)
      return
    }
    
    if (getWordCount(feedbackData.feedback_text) > 125) {
      showMessage('feedback', 'Feedback must be 125 words or less', 3000)
      return
    }

    setLoading(prev => ({ ...prev, feedback: true }))
    
    try {
      console.log('Starting OpenAI feedback evaluation...')
      await evaluateFeedback(feedbackData.feedback_text)
      
      await submitFeedback(feedbackData)
      
      setFeedbackData({ feedback_text: '', contact_info: '' })
      localStorage.removeItem('antithesis_feedback_data')
      
      showMessage('feedback', 'Feedback submitted successfully!', 5000)
      console.log('System Success: Feedback submitted successfully')
      
    } catch (error) {
      console.error('System Error: Failed to submit feedback', error)
      
      if (error.message.includes('rejected')) {
        console.log('OpenAI Content Rejection: Feedback blocked -', error.message)
        let errorMessage = 'Feedback rejected: '
        
        // Determine which rule was triggered
        const reason = error.message.toLowerCase()
        if (reason.includes('spam') || reason.includes('junk')) {
          errorMessage += 'Content appears to be spam or irrelevant'
        } else if (reason.includes('contact') || reason.includes('personal')) {
          errorMessage += 'Personal contact information is not allowed'
        } else if (reason.includes('malicious') || reason.includes('inappropriate')) {
          errorMessage += 'Content violates community guidelines'
        } else if (reason.includes('link')) {
          errorMessage += 'Irrelevant or harmful links are not allowed'
        } else if (reason.includes('empty') || reason.includes('meaningful')) {
          errorMessage += 'Please provide more meaningful feedback'
        } else {
          errorMessage = error.message
        }
        
        showMessage('feedback', errorMessage, 8000)
      } else if (error.message.includes('security policy')) {
        console.log('RLS Policy Decline: Access denied by security policy')
        showMessage('feedback', 'Access denied by security policy', 5000)
      } else {
        showMessage('feedback', `Error: ${error.message}`, 5000)
      }
    } finally {
      setLoading(prev => ({ ...prev, feedback: false }))
    }
  }

  return (
    <div className="container">
      {/* Top Row */}
      <div className="top-row">
        {/* Ideas List */}
        <div className="card">
          <div className="refresh-indicator">
            <div className="clock-icon">⏰</div>
            <span>Refreshing in {refreshTimer}s</span>
          </div>
          <h2>Ideas ({ideas.length})</h2>
          <div className="scrollable">
            {ideas.map(idea => (
              <div
                key={idea.id}
                className={`idea-item ${!idea.visible ? 'hidden' : ''}`}
                onClick={() => setSelectedIdea(idea)}
              >
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {idea.full_name}
                </div>
                <div style={{ fontSize: '14px', color: '#666' }}>
                  {!idea.visible ? '*** Content Hidden ***' : 
                   idea.product_idea.substring(0, 100) + (idea.product_idea.length > 100 ? '...' : '')}
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                  {new Date(idea.timestamp).toLocaleDateString()}
                </div>
              </div>
            ))}
            {ideas.length === 0 && (
              <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
                No ideas yet
              </div>
            )}
          </div>
        </div>

        {/* My Submissions */}
        <div className="card">
          <div className="refresh-indicator">
            <div className="clock-icon">⏰</div>
            <span>Refreshing in {refreshTimer}s</span>
          </div>
          <h2>My Submissions ({mySubmissions.length})</h2>
          <div className="scrollable">
            {mySubmissions.map(submission => (
              <div
                key={submission.id}
                className="submission-item"
                onClick={() => setSelectedIdea(submission)}
              >
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {submission.visible ? '✅ Approved' : '❌ Hidden'}
                </div>
                <div style={{ fontSize: '14px' }}>
                  {submission.product_idea.substring(0, 80) + (submission.product_idea.length > 80 ? '...' : '')}
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                  {new Date(submission.timestamp).toLocaleDateString()}
                </div>
                {submission.rejection_reason && (
                  <div style={{ fontSize: '12px', color: 'var(--accent3)', marginTop: '2px' }}>
                    Reason: {submission.rejection_reason}
                  </div>
                )}
              </div>
            ))}
            {mySubmissions.length === 0 && (
              <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
                No submissions yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Middle Row */}
      <div className="middle-row">
        {/* Submission Form */}
        <div className="card">
          <h2>Submit Your Idea</h2>
          {messages.idea && (
            <div className={`message ${messages.idea.includes('Error') || messages.idea.includes('rejected') || messages.idea.includes('wait') ? 'error' : 'success'}`}>
              {messages.idea}
            </div>
          )}
          <form onSubmit={handleIdeaSubmit}>
            <div className="form-group">
              <label>Full Name *</label>
              <input
                type="text"
                value={formData.full_name}
                onChange={(e) => handleFormChange('full_name', e.target.value)}
                required
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label>Who You Serve *</label>
              <input
                type="text"
                value={formData.who_to_serve}
                onChange={(e) => handleFormChange('who_to_serve', e.target.value)}
                required
                maxLength={250}
              />
              <div className={`word-count ${getWordCount(formData.who_to_serve) > 50 ? 'over-limit' : ''} ${getWordCount(formData.who_to_serve) < 10 ? 'under-limit' : ''}`}>
                {getWordCount(formData.who_to_serve)}/50 words (minimum: 10)
              </div>
            </div>

            <div className="form-group">
              <label>Product Idea *</label>
              <textarea
                value={formData.product_idea}
                onChange={(e) => handleFormChange('product_idea', e.target.value)}
                required
                maxLength={750}
                rows={4}
              />
              <div className={`word-count ${getWordCount(formData.product_idea) > 150 ? 'over-limit' : ''} ${getWordCount(formData.product_idea) < 25 ? 'under-limit' : ''}`}>
                {getWordCount(formData.product_idea)}/150 words (minimum: 25)
              </div>
            </div>

            <div className="form-group">
              <label>Categories</label>
              <div className="checkbox-group">
                {CATEGORIES.map(category => (
                  <div key={category} className="checkbox-item">
                    <input
                      type="checkbox"
                      id={category}
                      checked={formData.categories.includes(category)}
                      onChange={() => handleFormChange('categories', category)}
                    />
                    <label htmlFor={category}>{category}</label>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>How You Heard About Antithesis</label>
              <select
                value={formData.source}
                onChange={(e) => handleFormChange('source', e.target.value)}
              >
                <option value="">Select...</option>
                {HEAR_ABOUT_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            {formData.source === 'Other' && (
              <div className="form-group">
                <label>Please specify</label>
                <input
                  type="text"
                  value={formData.other_source}
                  onChange={(e) => handleFormChange('other_source', e.target.value)}
                  maxLength={100}
                />
              </div>
            )}

            <button
              type="submit"
              className="btn"
              disabled={loading.idea || !canSubmitIdea()}
            >
              {loading.idea ? 'Submitting...' : 
               !canSubmitIdea() ? 
               `Wait ${Math.ceil((60000 - (Date.now() - lastSubmissionTime)) / 1000)}s` : 
               'Submit Idea'}
            </button>
          </form>
        </div>

        {/* Mini Guide & Process Diagram */}
        <div className="card">
          <h2>Submission Guide</h2>
          
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ color: 'var(--accent3)', fontSize: '14px', marginBottom: '8px' }}>
              ❌ This is NOT how to submit
            </h3>
            <div style={{ background: '#ffebee', padding: '10px', borderRadius: '6px', fontSize: '12px', marginBottom: '15px' }}>
              "Make an app" or "Social media platform" or "john.doe@email.com call me at 555-1234"
            </div>
            
            <h3 style={{ color: 'var(--primary)', fontSize: '14px', marginBottom: '8px' }}>
              ✅ This is a good submission
            </h3>
            <div style={{ background: 'var(--accent1)', padding: '10px', borderRadius: '6px', fontSize: '12px' }}>
              "A mobile app that helps elderly people connect with nearby volunteers for grocery shopping and errands, featuring real-time tracking and safety verification."
            </div>
          </div>

          <h2>Process Overview</h2>
          <div className="process-diagram">
            <div className="process-step">
              <strong>1. Submit:</strong> Your idea gets AI-checked for spam & privacy
            </div>
            <div className="process-step">
              <strong>2. Round 1-2:</strong> OpenAI evaluates ideas on 10 criteria:
              Problem Significance, Market Fit, Uniqueness, Feasibility, Scalability, Competition, Business Viability, Adoption Potential, Risk, Impact
            </div>
            <div className="process-step">
              <strong>3. Round 3:</strong> Human judging selects top ~10% of ideas
            </div>
            <div className="process-step">
              <strong>4. S&P 500 Stage:</strong> NGOs & mentors provide funding/mentoring for selected ideas
            </div>
            <div className="process-step">
              <strong>5. Feedback:</strong> Users can provide anonymous feedback or contact info for collaboration
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="bottom-row">
        <div className="card">
          <h2>Feedback</h2>
          {messages.feedback && (
            <div className={`message ${messages.feedback.includes('Error') || messages.feedback.includes('rejected') ? 'error' : 'success'}`}>
              {messages.feedback}
            </div>
          )}
          <form onSubmit={handleFeedbackSubmit}>
            <div className="form-group">
              <label>Your Feedback *</label>
              <textarea
                value={feedbackData.feedback_text}
                onChange={(e) => setFeedbackData(prev => ({ ...prev, feedback_text: e.target.value }))}
                required
                maxLength={625}
                rows={3}
                placeholder="Share your thoughts about the platform or ideas..."
              />
              <div className={`word-count ${getWordCount(feedbackData.feedback_text) > 125 ? 'over-limit' : ''} ${getWordCount(feedbackData.feedback_text) < 15 ? 'under-limit' : ''}`}>
                {getWordCount(feedbackData.feedback_text)}/125 words (minimum: 15)
              </div>
            </div>

            <div className="form-group">
              <label>Contact Info (Optional)</label>
              <input
                type="text"
                value={feedbackData.contact_info}
                onChange={(e) => setFeedbackData(prev => ({ ...prev, contact_info: e.target.value }))}
                maxLength={100}
                placeholder="Email or social media handle (optional)"
              />
            </div>

            <button
              type="submit"
              className="btn"
              disabled={loading.feedback}
            >
              {loading.feedback ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </form>
        </div>
      </div>

      {/* Modal for idea details */}
      {selectedIdea && (
        <div className="modal" onClick={() => setSelectedIdea(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedIdea.full_name}</h2>
              <button className="close-btn" onClick={() => setSelectedIdea(null)}>
                ×
              </button>
            </div>
            <div>
              <p><strong>Who They Serve:</strong></p>
              <p style={{ marginBottom: '15px' }}>
                {!selectedIdea.visible ? '*** Content Hidden ***' : selectedIdea.who_to_serve}
              </p>
              
              <p><strong>Product Idea:</strong></p>
              <p style={{ marginBottom: '15px' }}>
                {!selectedIdea.visible ? '*** Content Hidden ***' : selectedIdea.product_idea}
              </p>
              
              {selectedIdea.categories && selectedIdea.categories.length > 0 && (
                <>
                  <p><strong>Categories:</strong></p>
                  <p style={{ marginBottom: '15px' }}>
                    {selectedIdea.categories.join(', ')}
                  </p>
                </>
              )}
              
              {selectedIdea.source && (
                <>
                  <p><strong>Source:</strong></p>
                  <p style={{ marginBottom: '15px' }}>{selectedIdea.source}</p>
                </>
              )}
              
              <p style={{ fontSize: '12px', color: '#666' }}>
                Submitted: {new Date(selectedIdea.timestamp).toLocaleString()}
              </p>
              
              {selectedIdea.rejection_reason && (
                <p style={{ fontSize: '12px', color: 'var(--accent3)', marginTop: '10px' }}>
                  <strong>Rejection Reason:</strong> {selectedIdea.rejection_reason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard