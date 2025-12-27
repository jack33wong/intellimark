# 🎓 Admin Features - Past Papers Management

The AI Marking Chat application now includes a comprehensive admin dashboard for managing past paper PDFs, organized by exam board and year.

## ✨ **Features Overview**

### 📤 **File Upload System**
- **PDF Upload**: Drag & drop or click to upload PDF files
- **File Validation**: Only PDF files accepted (max 50MB)
- **Metadata Management**: Organize by exam board, year, subject, and paper type
- **Automatic Organization**: Files automatically organized in folder structure

### 🗂️ **Organization Structure**
```
backend/uploads/
├── AQA/
│   ├── 2024/
│   │   ├── Mathematics/
│   │   ├── Physics/
│   │   └── Chemistry/
│   └── 2023/
│       ├── Mathematics/
│       └── Physics/
├── Edexcel/
│   ├── 2024/
│   └── 2023/
└── OCR/
    ├── 2024/
    └── 2023/
```

### 🔍 **Search & Filtering**
- **Text Search**: Search across subject, exam board, and description
- **Exam Board Filter**: Filter by specific exam boards (AQA, Edexcel, OCR, etc.)
- **Year Filter**: Filter by specific years
- **Subject Filter**: Filter by specific subjects
- **Paper Type Filter**: Filter by paper type (Main, Foundation, Higher, Mark Scheme)

### 📊 **Paper Management**
- **View All Papers**: Grid layout with paper cards
- **Edit Metadata**: Update exam board, year, subject, paper type, and description
- **Delete Papers**: Remove papers with confirmation
- **Download Papers**: Direct download with download count tracking
- **File Information**: Display file size, upload date, and download statistics

## 🚀 **How to Use**

### **Accessing the Admin Panel**
1. Click the "Admin" button in the left sidebar
2. You'll be redirected to `/admin` route
3. Use the "Back to Chat" button to return to the main chat interface

### **Uploading a New Past Paper**
1. Click "Upload New Paper" button
2. Fill in the required fields:
   - **Exam Board**: e.g., AQA, Edexcel, OCR
   - **Year**: e.g., 2024, 2023
   - **Subject**: e.g., Mathematics, Physics, Chemistry
   - **Paper Type**: Main, Foundation, Higher, or Mark Scheme
   - **Description**: Optional additional information
   - **PDF File**: Select your PDF file (max 50MB)
3. Click "Upload Paper"

### **Managing Existing Papers**
- **Edit**: Click the edit icon to modify paper metadata
- **Delete**: Click the trash icon to remove papers
- **Download**: Click the download button to access the PDF
- **Filter**: Use the filter section to find specific papers

## 🔧 **Technical Implementation**

### **Backend API Endpoints**
```
GET    /api/admin/past-papers          # Get all papers
GET    /api/admin/past-papers/board/:examBoard  # Get papers by board
GET    /api/admin/past-papers/year/:year        # Get papers by year
POST   /api/admin/past-papers/upload            # Upload new paper
PUT    /api/admin/past-papers/:id               # Update paper metadata
DELETE /api/admin/past-papers/:id               # Delete paper
GET    /api/admin/past-papers/:id/download      # Download paper
GET    /api/admin/exam-boards                   # Get available boards
GET    /api/admin/years                         # Get available years
GET    /api/admin/subjects                      # Get available subjects
```

### **File Storage**
- **Local Storage**: Files stored in `backend/uploads/` directory
- **Organized Structure**: Automatic folder creation based on exam board and year
- **Unique Naming**: UUID-based filenames to prevent conflicts
- **Metadata Tracking**: Separate metadata storage for quick access

### **Security Features**
- **File Type Validation**: Only PDF files accepted
- **File Size Limits**: 50MB maximum file size
- **Input Validation**: All form inputs validated server-side
- **Error Handling**: Comprehensive error handling and user feedback

## 📱 **Responsive Design**

### **Desktop View**
- Full-width layout with optimal spacing
- Grid layout for paper cards
- Side-by-side form fields
- Hover effects and animations

### **Mobile View**
- Stacked layout for small screens
- Touch-friendly buttons and inputs
- Responsive grid that adapts to screen size
- Optimized spacing for mobile devices

## 🧪 **Testing**

### **Backend Tests**
- API endpoint testing with Jest and Supertest
- File upload validation testing
- Error handling testing
- Metadata management testing

### **Frontend Tests**
- Component rendering tests
- User interaction testing
- Form validation testing
- Responsive design testing

## 🔮 **Future Enhancements**

### **Planned Features**
- [ ] **User Authentication**: Secure admin access
- [ ] **Bulk Upload**: Multiple file upload support
- [ ] **File Preview**: PDF thumbnail generation
- [ ] **Advanced Search**: Full-text search within PDFs
- [ ] **Analytics Dashboard**: Upload and download statistics
- [ ] **Export Functionality**: CSV/Excel export of paper metadata
- [ ] **Cloud Storage**: Integration with AWS S3 or similar
- [ ] **Version Control**: Track changes to paper metadata

### **Database Integration**
- [ ] **PostgreSQL/MongoDB**: Replace in-memory storage
- [ ] **File Metadata**: Store paper information in database
- [ ] **User Management**: Admin user accounts and permissions
- [ ] **Audit Logs**: Track all admin actions

## 🐛 **Troubleshooting**

### **Common Issues**
1. **File Upload Fails**
   - Check file size (must be under 50MB)
   - Ensure file is PDF format
   - Verify all required fields are filled

2. **Files Not Displaying**
   - Check backend server is running
   - Verify uploads directory exists
   - Check file permissions

3. **Filter Not Working**
   - Ensure data is loaded (check network tab)
   - Verify filter values match exact case
   - Clear filters and try again

### **Performance Tips**
- **Large Files**: Consider compressing PDFs before upload
- **Many Papers**: Use filters to narrow down results
- **Regular Cleanup**: Remove unused papers to save space

## 📚 **API Documentation**

### **Paper Object Structure**
```json
{
  "id": "uuid-string",
  "examBoard": "AQA",
  "year": "2024",
  "subject": "Mathematics",
  "paperType": "Main",
  "description": "Optional description",
  "filename": "unique-filename.pdf",
  "originalName": "original-name.pdf",
  "filePath": "/path/to/file",
  "fileSize": 1024000,
  "uploadedAt": "2024-01-01T00:00:00.000Z",
  "downloadCount": 0
}
```

### **Upload Response**
```json
{
  "message": "Past paper uploaded successfully",
  "pastPaper": { /* paper object */ }
}
```

### **Error Response**
```json
{
  "error": "Error description",
  "message": "Additional error details"
}
```

---

🎉 **The admin panel is now fully functional!** You can upload, organize, and manage past paper PDFs with a clean, intuitive interface that follows the same design principles as the main chat application.
