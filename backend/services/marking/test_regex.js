function checkLabelMatch(text, label) {
    if (!text || !label) return false;
    const cleanT = text.replace(/\\+|\/+|\[|\]|\(|\)|\s+|\./g, '').toLowerCase();
    const match = label.match(/^(\d+)([a-z]+)?/);
    const num = match ? match[1] : label;
    const sub = match ? match[2] : null;

    if (sub) {
        const combined = new RegExp('^' + num + sub, 'i');
        const divided = new RegExp('^' + num + '.*' + sub, 'i');
        const naked = new RegExp('^[\\s\\(\\.]*' + sub + '[\\s\\.\\)]', 'i');

        console.log('--- checkLabelMatch ---');
        console.log('Text:', text);
        console.log('Label:', label);
        console.log('Num:', num, 'Sub:', sub);
        console.log('Combined Regex:', combined.source, 'Match:', combined.test(cleanT));
        console.log('Divided Regex:', divided.source, 'Match:', divided.test(text.toLowerCase()));
        console.log('Naked Regex:', naked.source, 'Match:', naked.test(text.toLowerCase()));
        
        return combined.test(cleanT) || divided.test(text.toLowerCase()) || naked.test(text.toLowerCase());
    }
    return false;
}

const text = "i) \\( y=x^{2}-4 \\)";
const label = "12i";
console.log('Result:', checkLabelMatch(text, label));

const normalizedCandidate = "i y=x^{2}-4"; // This is what gets passed to checkLabelMatch in findBestBlockSequential
console.log('\n--- Using Normalized Candidate ---');
console.log('Result:', checkLabelMatch(normalizedCandidate, label));
