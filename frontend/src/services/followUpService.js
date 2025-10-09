/**
 * Follow-up Service
 * Handles suggested follow-up actions
 */

export class FollowUpService {
  /**
   * Handle follow-up action based on the suggestion text
   * @param {string} suggestion - The suggestion text
   * @param {Object} context - Context including sessionId, messageId, etc.
   */
  static async handleFollowUp(suggestion, context) {

    try {
      // Map suggestion text to action type
      const actionType = this.mapSuggestionToAction(suggestion);
      
      switch (actionType) {
        case 'model_answer':
          return await this.handleModelAnswer(context);
        case 'detailed_feedback':
          return await this.handleDetailedFeedback(context);
        case 'marking_scheme':
          return await this.handleMarkingScheme(context);
        case 'step_by_step_solution':
          return await this.handleStepByStepSolution(context);
        case 'similar_practice_questions':
          return await this.handleSimilarPracticeQuestions(context);
        case 'try_another_question':
          return await this.handleTryAnotherQuestion(context);
        default:
          console.warn('🎯 [FOLLOW-UP] Unknown action type:', actionType);
          return { success: false, error: 'Unknown action type' };
      }
    } catch (error) {
      console.error('🎯 [FOLLOW-UP] Error handling follow-up:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Map suggestion text to action type
   * @param {string} suggestion - The suggestion text
   * @returns {string} - The action type
   */
  static mapSuggestionToAction(suggestion) {
    const suggestionLower = suggestion.toLowerCase();
    
    if (suggestionLower.includes('model answer')) {
      return 'model_answer';
    } else if (suggestionLower.includes('detailed feedback')) {
      return 'detailed_feedback';
    } else if (suggestionLower.includes('marking scheme')) {
      return 'marking_scheme';
    } else if (suggestionLower.includes('step-by-step solution') || suggestionLower.includes('step by step solution')) {
      return 'step_by_step_solution';
    } else if (suggestionLower.includes('similar practice questions')) {
      return 'similar_practice_questions';
    } else if (suggestionLower.includes('try another question')) {
      return 'try_another_question';
    }
    
    return 'unknown';
  }

  /**
   * Handle model answer request
   */
  static async handleModelAnswer(context) {
    
    try {
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Provide model answer?',
          sessionId: context.sessionId,
          model: 'auto',
          mode: 'chat'
        })
      });
      
      
      const result = await response.json();
      
      if (result.success) {
        return {
          success: true,
          action: 'model_answer',
          message: 'Chat message created',
          data: {
            aiMessage: result.aiMessage
          }
        };
      } else {
        console.error('❌ [FOLLOW-UP] Chat message creation failed:', result.error);
        return {
          success: false,
          action: 'model_answer',
          error: result.error
        };
      }
    } catch (error) {
      console.error('❌ [FOLLOW-UP] Chat message request failed:', error);
      return {
        success: false,
        action: 'model_answer',
        error: error.message
      };
    }
  }

  /**
   * Handle detailed feedback request
   */
  static async handleDetailedFeedback(context) {
    
    // TODO: Implement detailed feedback generation
    // This would call the backend to generate more detailed feedback
    
    return {
      success: true,
      action: 'detailed_feedback',
      message: 'Detailed feedback generation is coming soon!',
      data: null
    };
  }

  /**
   * Handle marking scheme request
   */
  static async handleMarkingScheme(context) {
    
    // TODO: Implement marking scheme display
    // This would show the marking scheme for the question
    
    return {
      success: true,
      action: 'marking_scheme',
      message: 'Marking scheme display is coming soon!',
      data: null
    };
  }

  /**
   * Handle step-by-step solution request
   */
  static async handleStepByStepSolution(context) {
    
    // TODO: Implement step-by-step solution generation
    
    return {
      success: true,
      action: 'step_by_step_solution',
      message: 'Step-by-step solution generation is coming soon!',
      data: null
    };
  }

  /**
   * Handle similar practice questions request
   */
  static async handleSimilarPracticeQuestions(context) {
    
    // TODO: Implement similar practice questions search
    
    return {
      success: true,
      action: 'similar_practice_questions',
      message: 'Similar practice questions search is coming soon!',
      data: null
    };
  }

  /**
   * Handle try another question request
   */
  static async handleTryAnotherQuestion(context) {
    
    // TODO: Implement new question flow
    // This might clear the current session or navigate to a new question
    
    return {
      success: true,
      action: 'try_another_question',
      message: 'New question flow is coming soon!',
      data: null
    };
  }
}

export default FollowUpService;
