/**
 * Layout Test Component
 * Simple test to verify sidebar and main content layout
 */

import React from 'react';
import './LayoutTest.css';

const LayoutTest = () => {
  return (
    <div className="layout-test">
      <div className="test-sidebar">
        <h3>Sidebar (Left)</h3>
        <p>This should be on the left side</p>
      </div>
      <div className="test-main">
        <h3>Main Content (Right)</h3>
        <p>This should be on the right side</p>
        <div className="test-chat-container">
          <h4>Chat Container</h4>
          <div className="test-messages">
            <div className="test-message">Message 1</div>
            <div className="test-message">Message 2</div>
            <div className="test-message">Message 3</div>
            <div className="test-message">Message 4</div>
            <div className="test-message">Message 5</div>
            <div className="test-message">Message 6</div>
            <div className="test-message">Message 7</div>
            <div className="test-message">Message 8</div>
            <div className="test-message">Message 9</div>
            <div className="test-message">Message 10</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutTest;
