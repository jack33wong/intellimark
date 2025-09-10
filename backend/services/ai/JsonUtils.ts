export class JsonUtils {
  static cleanAndValidateJSON(response: string, expectedArrayKey: string): any {
    let cleanedResponse = response.trim();
    const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      cleanedResponse = jsonMatch[1];
    }
    cleanedResponse = cleanedResponse
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([{|\[,])\s*([}\]])/g, '$1$2')
      .replace(/(\w+):/g, '"$1":')
      .replace(/'/g, '"')
      .replace(/,(\s*})/g, '$1')
      .replace(/,(\s*\])/g, '$1')
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2');
    let result: any;
    try {
      result = JSON.parse(cleanedResponse);
    } catch {
      result = { [expectedArrayKey]: [] };
    }
    if (!result[expectedArrayKey] || !Array.isArray(result[expectedArrayKey])) {
      throw new Error(`AI response missing ${expectedArrayKey} array`);
    }
    return result;
  }
}


