
function levenshtein(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

const clean = (str: string) => str.toLowerCase()
    .replace(/[\s\\]/g, '')
    .replace(/frac|sqrt|times|div|rightarrow|Rightarrow/g, '') // Added rightarrow
    .replace(/[(){}\[\]]/g, '');

const student = "x red \\Rightarrow \\frac{5}{3}x yellow";
const ocr = "\\( x \\) red \\( \\Rightarrow 3 / 3 x \\) yollow";

const sClean = clean(student);
const oClean = clean(ocr);

const dist = levenshtein(sClean, oClean);
const allowed = sClean.length < 5 ? 0 : sClean.length < 10 ? 1 : 2;

console.log(`Student: "${student}" -> "${sClean}"`);
console.log(`OCR:     "${ocr}" -> "${oClean}"`);
console.log(`Distance: ${dist}`);
console.log(`Allowed:  ${allowed}`);
console.log(`Match?    ${dist <= allowed}`);
