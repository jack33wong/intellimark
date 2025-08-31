# Firestore Integration for Exam Metadata

## Overview
The upload function has been enhanced to save exam metadata to Google Firestore while maintaining local file storage for PDFs. This provides a robust, scalable solution for managing exam paper metadata.

## Features

### 🔥 **Firestore Integration**
- **Metadata Storage**: All exam metadata is automatically saved to Firestore
- **Real-time Sync**: Data is synchronized between Firestore and local storage
- **Automatic Backup**: Metadata is preserved even if local storage is lost
- **Scalable**: Can handle thousands of exam papers efficiently

### 📁 **Local File Storage**
- **PDF Storage**: PDF files remain stored locally for fast access
- **Organized Structure**: Files are organized by `{examBoard}/{year}/` directories
- **Backward Compatibility**: Existing functionality remains unchanged

## Architecture

```
Frontend Upload → Backend Processing → File Storage + Firestore Metadata
     ↓                    ↓                    ↓
  PDF File           Metadata Extract    Local + Cloud Storage
```

## Data Flow

1. **File Upload**: User selects PDF and form is auto-filled
2. **Backend Processing**: File is saved locally, metadata extracted
3. **Dual Storage**: 
   - PDF saved to `backend/uploads/{examBoard}/{year}/`
   - Metadata saved to Firestore `pastPapers` collection
4. **Sync**: Local storage and Firestore remain synchronized

## Firestore Collection Structure

### Collection: `pastPapers`
Each document represents an exam paper with the following fields:

```javascript
{
  id: "uuid-string",
  examBoard: "AQA",
  year: 2024,
  level: "Higher",
  paper: "83001H",
  type: "Question Paper",
  qualification: "GCSE",
  filename: "uuid-originalname.pdf",
  originalName: "AQA-83001H-QP-JUN24.PDF",
  filePath: "/path/to/local/file",
  fileSize: 3726677,
  uploadedAt: "2025-08-30T16:23:57.927Z",
  downloadCount: 0,
  updatedAt: "2025-08-30T16:25:00.000Z" // Optional
}
```

## API Endpoints

### Enhanced Endpoints
- **POST** `/api/admin/past-papers/upload` - Upload with Firestore storage
- **PUT** `/api/admin/past-papers/:id` - Update with Firestore sync
- **DELETE** `/api/admin/past-papers/:id` - Delete with Firestore cleanup
- **GET** `/api/admin/past-papers/:id/download` - Download with count sync

### New Endpoints
- **POST** `/api/admin/sync-firestore` - Sync data from Firestore to local

## Error Handling

### Graceful Degradation
- If Firestore is unavailable, local storage continues to work
- Uploads succeed even if metadata sync fails
- Local operations remain functional during Firestore issues

### Logging
- Comprehensive logging for debugging
- Firestore operation status tracked
- Error details logged for troubleshooting

## Configuration

### Firebase Setup
- Service account key: `intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json`
- Project ID: `intellimark-6649e`
- Collection: `pastPapers`

### Environment Variables
```bash
# Firebase configuration is handled via service account key
# No additional environment variables required
```

## Benefits

### 🚀 **Performance**
- Fast local file access
- Efficient metadata queries
- Reduced API response times

### 🔒 **Reliability**
- Data redundancy (local + cloud)
- Automatic backup to Firestore
- No data loss during system failures

### 📈 **Scalability**
- Firestore handles large datasets
- Automatic indexing and optimization
- Real-time updates and synchronization

### 🔄 **Maintenance**
- Easy data migration
- Backup and restore capabilities
- Monitoring and analytics

## Usage Examples

### Upload with Auto-Fill
```javascript
// Frontend automatically extracts metadata
const formData = new FormData();
formData.append('pdfFile', file);
formData.append('examBoard', 'AQA');
formData.append('year', '2024');
formData.append('level', 'Higher');
formData.append('paper', '83001H');

// Backend saves to both local storage and Firestore
const response = await fetch('/api/admin/past-papers/upload', {
  method: 'POST',
  body: formData
});
```

### Sync from Firestore
```javascript
// Sync data from Firestore to local storage
const response = await fetch('/api/admin/sync-firestore', {
  method: 'POST'
});

const result = await response.json();
console.log(`Synced ${result.syncedCount} papers`);
```

## Migration

### From Local-Only to Firestore
1. Existing data remains functional
2. New uploads automatically sync to Firestore
3. Use sync endpoint to populate Firestore with existing data
4. Gradual migration without downtime

### Data Recovery
- Firestore serves as backup for metadata
- Local files can be restored from metadata
- Sync endpoint rebuilds local storage from Firestore

## Security

### Service Account
- Limited permissions for specific operations
- No user data access
- Secure key management

### Data Access
- Metadata stored in Firestore
- Files remain in local storage
- No public access to sensitive data

## Monitoring

### Firestore Console
- Real-time data monitoring
- Usage analytics
- Performance metrics

### Application Logs
- Upload success/failure tracking
- Sync operation status
- Error reporting and debugging

## Future Enhancements

### Planned Features
- **Real-time Updates**: Live synchronization across multiple instances
- **Advanced Queries**: Complex filtering and search capabilities
- **Analytics**: Usage patterns and insights
- **Backup**: Automated backup scheduling
- **Multi-region**: Geographic data distribution

### Integration Possibilities
- **Google Analytics**: Track usage patterns
- **BigQuery**: Advanced data analysis
- **Cloud Functions**: Automated processing
- **Cloud Storage**: Alternative file storage option
