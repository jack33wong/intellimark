export class JsonUtils {
  static cleanAndValidateJSON(response: string, expectedArrayKey: string): any {
    let cleanedResponse = response.trim();
    
    // First, try to extract JSON from markdown code blocks
    const jsonMatch = cleanedResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      cleanedResponse = jsonMatch[1];
    }
    
    // Try to parse as-is first (most AI responses are already valid JSON)
    let result: any;
    try {
      result = JSON.parse(cleanedResponse);
      // If successful and has the expected array, return it
      if (result[expectedArrayKey] && Array.isArray(result[expectedArrayKey])) {
        return result;
      }
    } catch (error) {
      // If parsing fails, try to clean it up
      console.log('🔍 [JSON UTILS] Initial parse failed, attempting cleanup...');
    }
    
    // Only apply aggressive cleaning if initial parse failed
    cleanedResponse = cleanedResponse
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([{|\[,])\s*([}\]])/g, '$1$2')
      .replace(/(\w+):/g, '"$1":')
      .replace(/'/g, '"')
      .replace(/,(\s*})/g, '$1')
      .replace(/,(\s*\])/g, '$1')
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1\\\\$2');
    
    try {
      result = JSON.parse(cleanedResponse);
    } catch (error) {
      console.error('🔍 [JSON UTILS] Cleanup parse also failed:', error);
      result = { [expectedArrayKey]: [] };
    }
    
    if (!result[expectedArrayKey] || !Array.isArray(result[expectedArrayKey])) {
      throw new Error(`AI response missing ${expectedArrayKey} array`);
    }
    return result;
  }
}


