const path = require('path');

const TestData = {
  // Test images
  images: {
    step6FullPage: path.join(__dirname, '../../e2e/step6-full-page.jpg'),
    q19: path.join(__dirname, '../../e2e/test-data/q19.png'),
    q21: path.join(__dirname, '../../e2e/test-data/q21.png'),
  },

  // Test text messages
  messages: {
    mathQuestion: 'What is 2 + 2?',
    algebraQuestion: 'Can you help me solve this algebra problem?',
    geometryQuestion: 'How do I find the area of this triangle?',
    followUpQuestion: 'Can you explain that step in more detail?',
  },

  // Expected progress steps for different modes
  progressSteps: {
    marking: [
      'Analyzing image...',
      'Detecting question type...',
      'Extracting text and math...',
      'Generating feedback...',
      'Creating annotations...',
      'Finalizing response...',
      'Almost done...'
    ],
    question: [
      'Analyzing image...',
      'Detecting question type...',
      'Generating response...'
    ],
    chat: [
      'Processing your question...',
      'Generating response...'
    ]
  },

  // Test scenarios
  scenarios: {
    marking: {
      firstTime: {
        auth: 'A001',
        unauth: 'U001'
      },
      followUp: {
        auth: 'A002',
        unauth: 'U002'
      }
    },
    question: {
      firstTime: {
        auth: 'A003',
        unauth: 'U003'
      },
      followUp: {
        auth: 'A004',
        unauth: 'U004'
      }
    },
    chat: {
      firstTime: {
        auth: 'A005',
        unauth: 'U005'
      },
      followUp: {
        auth: 'A006',
        unauth: 'U006'
      }
    }
  },

  // Scroll test scenarios
  scrollScenarios: {
    imageMiddle: {
      position: 'middle',
      expectedScroll: false,
      description: 'Image upload from middle position - no auto-scroll'
    },
    imageNearBottom: {
      position: 'near-bottom',
      expectedScroll: true,
      description: 'Image upload from near bottom - auto-scroll'
    },
    textMiddle: {
      position: 'middle',
      expectedScroll: true,
      description: 'Text-only from middle position - auto-scroll'
    },
    textNearBottom: {
      position: 'near-bottom',
      expectedScroll: true,
      description: 'Text-only from near bottom - auto-scroll'
    }
  }
};

module.exports = { TestData };
