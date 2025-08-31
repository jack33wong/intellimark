# Auto-Fill Test Guide for Upload Form

## 🧪 **Testing the Auto-Fill Functionality**

The upload form now has enhanced auto-fill capabilities that extract exam information from PDF filenames. Here's how to test it:

## 📁 **Test Filenames to Try**

### **Format 1: [ExamBoard]-[Year]-[Level]-[Type] (Should Auto-Fill All Fields):**
1. `AQA-2024-Higher-QuestionPaper.pdf`
   - Expected: Exam Board: AQA, Year: 2024, Level: Higher, Type: Question Paper, Paper: (empty), Qualification: GCSE

2. `Edexcel-2023-Foundation-MarkScheme.pdf`
   - Expected: Exam Board: Edexcel, Year: 2023, Level: Foundation, Type: Mark Scheme, Paper: (empty), Qualification: GCSE

3. `OCR-2024-AS-Practice.pdf`
   - Expected: Exam Board: OCR, Year: 2024, Level: AS, Type: Practice, Paper: (empty), Qualification: GCSE

### **Format 2: [ExamBoard]-[PaperCode]-[Type]-[MonthYear] (Should Auto-Fill All Fields):**
4. `AQA-83001H-QP-JUN24.PDF` ⭐ **NEW FORMAT SUPPORTED!**
   - Expected: Exam Board: AQA, Year: 2024, Level: Higher, Paper: 83001H, Type: Question Paper, Qualification: GCSE

5. `Edexcel-1F-MS-SEP23.pdf`
   - Expected: Exam Board: Edexcel, Year: 2023, Level: Foundation, Paper: 1F, Type: Mark Scheme, Qualification: GCSE

6. `OCR-2H-QP-MAR24.pdf`
   - Expected: Exam Board: OCR, Year: 2024, Level: Higher, Paper: 2H, Type: Question Paper, Qualification: GCSE

### **Partial Format (Should Auto-Fill Some Fields):**
1. `AQA-2024-Higher.pdf`
   - Expected: Exam Board: AQA, Year: 2024, Level: Higher, Type: Question Paper (default), Paper: (empty), Qualification: GCSE

2. `Edexcel-2023-Foundation.pdf`
   - Expected: Exam Board: Edexcel, Year: 2023, Level: Foundation, Type: Question Paper (default), Paper: (empty), Qualification: GCSE

### **Year Only (Should Only Auto-Fill Year):**
1. `Maths-2024-Paper.pdf`
   - Expected: Year: 2024, other fields empty

2. `Physics_2023_Test.pdf`
   - Expected: Year: 2023, other fields empty

3. `Chemistry-1995-Exam.pdf`
   - Expected: Year: 1995, other fields empty (now supported!)

4. `Biology_2050_Test.pdf`
   - Expected: Year: 2050, other fields empty (future years supported!)

### **No Pattern (Should Not Auto-Fill):**
1. `paper.pdf`
   - Expected: All fields empty

2. `document.pdf`
   - Expected: All fields empty

## 🔍 **How to Test**

1. **Open the Admin Page**: Navigate to `http://localhost:3000/admin`
2. **Click "Upload New Paper"**: This will show the upload form
3. **Select a Test File**: Use one of the test filenames above
4. **Watch the Console**: Open browser DevTools (F12) to see debug logs
5. **Check Form Fields**: Verify that the fields are auto-filled correctly
6. **Look for Success Message**: You should see a green checkmark message

## 🐛 **Debug Information**

The console will now show detailed information about:
- File selection
- Filename parsing
- Extracted information
- Form state updates

### **Example Console Output for Format 1:**
```
File selected: AQA-2024-Higher-QuestionPaper.pdf
Extracting info from filename: AQA-2024-Higher-QuestionPaper.pdf
Name without extension: AQA-2024-Higher-QuestionPaper
Split parts: ['AQA', '2024', 'Higher', 'QuestionPaper']
Format 1 detected: {examBoard: 'AQA', year: 2024, level: 'Higher', type: 'QuestionPaper'}
Extracted info: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '', type: 'QuestionPaper', qualification: 'GCSE'}
Setting form with extracted info: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '', type: 'QuestionPaper', qualification: 'GCSE'}
New form state: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '', type: 'QuestionPaper', qualification: 'GCSE', pdfFile: File}
```

### **Example Console Output for Format 2 (Your Filename):**
```
File selected: AQA-83001H-QP-JUN24.PDF
Extracting info from filename: AQA-83001H-QP-JUN24.PDF
Name without extension: AQA-83001H-QP-JUN24
Split parts: ['AQA', '83001H', 'QP', 'JUN24']
Format 2 detected: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '83001H', type: 'Question Paper', qualification: 'GCSE'}
Extracted info: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '83001H', type: 'Question Paper', qualification: 'GCSE'}
Setting form with extracted info: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '83001H', type: 'Question Paper', qualification: 'GCSE'}
New form state: {examBoard: 'AQA', year: 2024, level: 'Higher', paper: '83001H', type: 'Question Paper', qualification: 'GCSE', pdfFile: File}
```

## ✅ **Success Indicators**

- **Form Fields Auto-Filled**: Exam Board, Year, Level, and Type should populate
- **Success Message**: Green checkmark with "Auto-filled from filename" message
- **No Errors**: Previous error messages should be cleared
- **Console Logs**: Detailed debugging information should appear

## ❌ **Common Issues & Solutions**

### **Issue: No Auto-Fill Happening**
- **Check**: Console for error messages
- **Solution**: Ensure filename follows the expected format

### **Issue: Only Some Fields Filled**
- **Check**: Filename format and separators
- **Solution**: Use consistent separators (dash, underscore, or space)

### **Issue: Year Not Recognized**
- **Check**: Year is between 1900-2100
- **Solution**: Use valid 4-digit years in the supported range

### **Issue: Form Not Updating**
- **Check**: Browser console for JavaScript errors
- **Solution**: Refresh page and try again

## 🎯 **Expected Behavior**

| Filename | Exam Board | Year | Level | Paper | Type | Qualification | Auto-Fill Status |
|----------|------------|------|-------|-------|------|---------------|------------------|
| `AQA-2024-Higher-QuestionPaper.pdf` | AQA | 2024 | Higher | (empty) | Question Paper | GCSE | ✅ Full |
| `AQA-83001H-QP-JUN24.PDF` | AQA | 2024 | Higher | 83001H | Question Paper | GCSE | ✅ Full |
| `Edexcel-2023-Foundation.pdf` | Edexcel | 2023 | Foundation | (empty) | Question Paper | GCSE | ✅ Partial |
| `OCR-2024-AS.pdf` | OCR | 2024 | AS | (empty) | Question Paper | GCSE | ✅ Partial |
| `Maths-2024-Paper.pdf` | (empty) | 2024 | (empty) | (empty) | Question Paper | GCSE | ✅ Year Only |
| `Chemistry-1995-Exam.pdf` | (empty) | 1995 | (empty) | (empty) | Question Paper | GCSE | ✅ Year Only |
| `Biology_2050_Test.pdf` | (empty) | 2050 | (empty) | (empty) | Question Paper | GCSE | ✅ Year Only |
| `paper.pdf` | (empty) | (empty) | (empty) | (empty) | Question Paper | GCSE | ❌ None |

## 🚀 **Advanced Testing**

### **Test Different Separators:**
- Dash: `AQA-2024-Higher-Main.pdf`
- Underscore: `AQA_2024_Higher_Main.pdf`
- Space: `AQA 2024 Higher Main.pdf`

### **Test Edge Cases:**
- Mixed separators: `AQA-2024_Higher Main.pdf`
- Extra spaces: `AQA - 2024 - Higher - Main.pdf`
- Special characters: `AQA_2024_Higher-Main.pdf`

## 📝 **Reporting Issues**

If auto-fill is not working:

1. **Check Console Logs**: Look for error messages or missing debug info
2. **Verify Filename**: Ensure it follows the expected format
3. **Test Simple Case**: Try with a basic filename like `AQA-2024-Higher-Main.pdf`
4. **Check Browser**: Ensure JavaScript is enabled and no errors

---

*This guide will help you test and verify that the auto-fill functionality is working correctly.*
