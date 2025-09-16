import React, { useState, useRef, useLayoutEffect } from 'react';

const SimpleChatTest = () => {
  // Start with empty messages, then load with delay (simulating API call)
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const chatContainerRef = useRef(null);

  // Simulate loading data with delay (like API call)
  React.useEffect(() => {
    
    // Sample data - more messages to ensure overflow
    const sampleMessages = [
      { id: 1, text: 'Hello! This is message 1' },
      { id: 2, text: 'This is message 2 with some longer content to make it more realistic' },
      { id: 3, text: 'Message 3: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' },
      { id: 4, text: 'Message 4: Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.' },
      { id: 5, text: 'Message 5: Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.' },
      { id: 6, text: 'Message 6: Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.' },
      { id: 7, text: 'Message 7: Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.' },
      { id: 8, text: 'Message 8: Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.' },
      { id: 9, text: 'Message 9: Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.' },
      { id: 10, text: 'Message 10: Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.' },
      { id: 11, text: 'Message 11: At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.' },
      { id: 12, text: 'Message 12: Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio.' },
      { id: 13, text: 'Message 13: Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.' },
      { id: 14, text: 'Message 14: Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae.' },
      { id: 15, text: 'Message 15: Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.' },
      { id: 16, text: 'Message 16: On the other hand, we denounce with righteous indignation and dislike men who are so beguiled and demoralized by the charms of pleasure of the moment.' },
      { id: 17, text: 'Message 17: So blinded by desire, that they cannot foresee the pain and trouble that are bound to ensue; and equal blame belongs to those who fail in their duty through weakness of will.' },
      { id: 18, text: 'Message 18: Which is the same as saying through shrinking from toil and pain. These cases are perfectly simple and easy to distinguish.' },
      { id: 19, text: 'Message 19: In a free hour, when our power of choice is untrammelled and when nothing prevents our being able to do what we like best, every pleasure is to be welcomed and every pain avoided.' },
      { id: 20, text: 'Message 20: But in certain circumstances and owing to the claims of duty or the obligations of business it will frequently occur that pleasures have to be repudiated and annoyances accepted.' },
      { id: 21, text: 'Message 21: Here is a large image that takes time to load', image: 'https://picsum.photos/600/400?random=1' },
      { id: 22, text: 'Message 22: Another message with more text content to ensure we have enough content to scroll through and test the auto-scroll functionality properly.' },
      { id: 23, text: 'Message 23: Second large image for testing', image: 'https://picsum.photos/500/300?random=2' },
      { id: 24, text: 'Message 24: More text content to push the scroll position and test if auto-scroll works correctly with mixed content.' },
      { id: 25, text: 'Message 25: Third large image with different dimensions', image: 'https://picsum.photos/700/200?random=3' },
      { id: 26, text: 'Message 26: Final message to test if auto-scroll reaches the very bottom of the chat container.' }
    ];
    
    const timer = setTimeout(() => {
      setMessages(sampleMessages);
      setIsLoading(false);
    }, 1000); // 1 second delay

    return () => clearTimeout(timer);
  }, []);

  // Simple scroll to bottom function
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  };

  // Auto-scroll when messages change
  useLayoutEffect(() => {
    console.log('🔄 Simple auto-scroll triggered:', {
      messageCount: messages.length
    });
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  // Load sample messages
  const loadSampleMessages = () => {
    const sampleMessages = [
      { id: 1, text: 'Hello! This is message 1' },
      { id: 2, text: 'This is message 2 with some longer content to make it more realistic' },
      { id: 3, text: 'Message 3: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' },
      { id: 4, text: 'Message 4: Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.' },
      { id: 5, text: 'Message 5: Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.' },
      { id: 6, text: 'Message 6: Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.' },
      { id: 7, text: 'Message 7: Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.' },
      { id: 8, text: 'Message 8: Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.' },
      { id: 9, text: 'Message 9: Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.' },
      { id: 10, text: 'Message 10: Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.' }
    ];
    
    setMessages(sampleMessages);
  };

  // Clear messages
  const clearMessages = () => {
    setMessages([]);
  };

  // Add single message
  const addMessage = () => {
    const newMessage = {
      id: Date.now(),
      text: `New message ${messages.length + 1} at ${new Date().toLocaleTimeString()}`
    };
    setMessages(prev => [...prev, newMessage]);
  };

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Mimicking the real app's parent structure */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
      <h1>Simple Chat Auto-Scroll Test</h1>
      
      {/* Control buttons */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button onClick={loadSampleMessages} style={{ padding: '10px 20px' }}>
          Load Sample Messages
        </button>
        <button onClick={addMessage} style={{ padding: '10px 20px' }}>
          Add Message
        </button>
        <button onClick={clearMessages} style={{ padding: '10px 20px' }}>
          Clear Messages
        </button>
      </div>

      {/* Chat container - mimicking real app structure */}
      <div 
        ref={chatContainerRef}
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          padding: 0,
          margin: 0,
          alignItems: 'stretch',
          overflowY: 'auto',
          overflowX: 'hidden',
          backgroundColor: '#f9f9f9',
          paddingBottom: '100px', // Space for fixed input bar + extra margin
          maxHeight: '400px', // Force a smaller fixed height
          minHeight: 0, // Allow flex item to shrink below content size
          border: '2px solid #ccc',
          borderRadius: '8px'
        }}
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
            Loading messages... (simulating API delay)
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
            No messages yet. Click "Load Sample Messages" to test auto-scroll.
          </div>
        ) : (
          messages.map((message) => (
            <div 
              key={message.id}
              style={{
                marginBottom: '10px',
                padding: '8px 12px',
                backgroundColor: '#e3f2fd',
                borderRadius: '6px',
                borderLeft: '4px solid #2196f3'
              }}
            >
              <strong>Message {message.id}:</strong> {message.text}
              {message.image && (
                <div style={{ marginTop: '8px' }}>
                  <img 
                    src={message.image} 
                    alt={`Message ${message.id}`}
                    style={{
                      maxWidth: '100%',
                      height: 'auto',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      backgroundColor: '#f0f0f0' // Show background while loading
                    }}
                    onLoad={() => {
                      // Trigger scroll after image loads (this is the key!)
                      setTimeout(() => {
                        if (chatContainerRef.current) {
                          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                        }
                      }, 50);
                    }}
                    onError={() => {
                      // Image failed to load
                    }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Debug info */}
      <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
        Messages: {messages.length} | 
        {isLoading ? 'Loading...' : 'Auto-scroll should work after delay'} | 
        Check console for scroll debug info
      </div>
      </div> {/* Close the mimicking parent div */}
    </div>
  );
};

export default SimpleChatTest;
