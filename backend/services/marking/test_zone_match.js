
const ZoneUtils = {
    normalizeLabel(label) {
        if (!label) return "";
        return label.toLowerCase().replace(/[\(\)\s\[\]]/g, '').replace(/^q/, '');
    },
    findAllMatchingZones(subQuestionLabel, zoneMap, questionPrefix) {
        if (!subQuestionLabel || !zoneMap) return [];
        const target = this.normalizeLabel(subQuestionLabel);
        const allKeys = Object.keys(zoneMap);
        const sortedKeys = allKeys.sort((a, b) => b.length - a.length);
        let bestMatchKey = "";
        for (const key of sortedKeys) {
            const normalizedKey = this.normalizeLabel(key);
            if (questionPrefix && !normalizedKey.startsWith(questionPrefix)) continue;
            if (normalizedKey === target || normalizedKey.endsWith(target) || target.endsWith(normalizedKey)) {
                bestMatchKey = key;
                break;
            }
        }
        return bestMatchKey ? zoneMap[bestMatchKey] : [];
    }
};

const semanticZones = {
    "10a": [{ pageIndex: 0, startY: 64, endY: 434, x: 45, width: 674 }],
    "10b": [{ pageIndex: 0, startY: 434, endY: 467, x: 45, width: 674 }],
    "10bi": [{ pageIndex: 0, startY: 467, endY: 559, x: 45, width: 674 }],
    "10bii": [{ pageIndex: 0, startY: 559, endY: 1016, x: 45, width: 674 }]
};

console.log("Match for 'bi' with prefix '10':", JSON.stringify(ZoneUtils.findAllMatchingZones("bi", semanticZones, "10")));
console.log("Match for '10bi' with prefix '10':", JSON.stringify(ZoneUtils.findAllMatchingZones("10bi", semanticZones, "10")));
console.log("Match for 'b' with prefix '10':", JSON.stringify(ZoneUtils.findAllMatchingZones("b", semanticZones, "10")));
