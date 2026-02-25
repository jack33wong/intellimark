
/**
 * Utility for coordinate audit logging.
 * Enabled via DEBUG_COORDINATE_AUDIT environment variable.
 */
export class CoordinateAuditLogger {
    private static isEnabled(): boolean {
        return process.env.LOG_COORDINATE_AUDIT === 'true' || process.env.DEBUG_COORDINATE_AUDIT === 'true';
    }

    /**
     * Logs a message only if coordinate auditing is enabled.
     * @param message The audit message
     * @param data Optional metadata
     */
    public static log(message: string, data?: any) {
        if (this.isEnabled()) {
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
            console.log(`📡 [${timestamp}][COORDS] ${message}${dataStr}`);
        }
    }

    /**
     * Critical audit point helper
     */
    public static audit(step: number, label: string, info: string) {
        if (this.isEnabled()) {
            console.log(` 🛡️ [AUDIT-${step}] ${label}: ${info}`);
        }
    }
}
