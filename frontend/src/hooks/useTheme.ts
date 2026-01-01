import { useState, useEffect } from 'react';
import EventManager from '../utils/eventManager';

export type Theme = 'light' | 'dark' | 'system';

export const useTheme = () => {
    // Initialize theme from localStorage or default to 'system'
    const [theme, setTheme] = useState<Theme>(() => {
        const savedTheme = localStorage.getItem('theme');
        return (savedTheme as Theme) || 'system';
    });

    // Effect to apply the theme to the document
    useEffect(() => {
        const root = window.document.documentElement;

        // Function to determine if dark mode should be active
        const isDark = (targetTheme: Theme) => {
            if (targetTheme === 'system') {
                return window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            return targetTheme === 'dark';
        };

        const applyTheme = () => {
            const dark = isDark(theme);
            if (dark) {
                root.classList.add('dark');
            } else {
                root.classList.remove('dark');
            }
        };

        applyTheme();

        // If system, listen for system changes
        if (theme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleChange = () => applyTheme();

            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        }

    }, [theme]);

    // Save preference when it changes
    const setIsTheme = (newTheme: Theme) => {
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        // Dispatch event for other components if needed (optional)
        EventManager.dispatch('themeChanged', { theme: newTheme });
    };

    return { theme, setTheme: setIsTheme };
};

export default useTheme;
