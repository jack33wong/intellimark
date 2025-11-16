/**
 * Library Group Component
 * Displays a collapsible group of library items for Exam Board → Subject → Year
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import LibraryItem from './LibraryItem';
import './LibraryGroup.css';
import type { LibraryItem as LibraryItemType } from '../../pages/LibraryPage';

interface LibraryGroupProps {
  examBoard: string;
  subject: string;
  year: string;
  items: LibraryItemType[];
  onThumbnailClick: (item: LibraryItemType, imageIndex: number) => void;
}

const LibraryGroup: React.FC<LibraryGroupProps> = ({
  examBoard,
  subject,
  year,
  items,
  onThumbnailClick
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const groupTitle = `${examBoard} ${subject} ${year}`;
  const itemCount = items.length;

  return (
    <div className="library-group">
      <button
        className="library-group-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={`Toggle ${groupTitle}`}
      >
        {isExpanded ? (
          <ChevronDown size={16} className="group-chevron" />
        ) : (
          <ChevronRight size={16} className="group-chevron" />
        )}
        <span className="group-title">{groupTitle}</span>
        <span className="group-count">({itemCount})</span>
      </button>

      {isExpanded && (
        <div className="library-group-content">
          {items.map(item => (
            <LibraryItem
              key={item.sessionId}
              item={item}
              onThumbnailClick={onThumbnailClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default LibraryGroup;

