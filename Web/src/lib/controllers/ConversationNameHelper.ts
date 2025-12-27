export class ConversationNameHelper {
    
    private static readonly WHITESPACE_REGEX = /\s+/g;

    /**
     * Clean and truncate text for conversation preview/title
     */
    public static cleanAndTruncateText(text: string, maxLength: number = 50): string {
        const cleanText = text
            .replace(/\r/g, ' ')
            .replace(/\n/g, ' ')
            .replace(this.WHITESPACE_REGEX, " ")
            .trim();
        
        if (cleanText.length <= maxLength) {
            return cleanText;
        } else {
            const truncateLength = maxLength - 3;
            const truncated = cleanText.substring(0, truncateLength);
            const lastSpace = truncated.lastIndexOf(' ');
            
            // If the last space is reasonably far (not at the very beginning), truncate at space
            if (lastSpace > truncateLength / 3) {
                return truncated.substring(0, lastSpace) + "...";
            } else {
                // Otherwise truncate directly
                return truncated + "...";
            }
        }
    }

    /**
     * Get default name for a new conversation based on index and type
     */
    public static getDefaultConversationName(index: number, isImageGeneration: boolean): string {
        return isImageGeneration 
            ? `图像生成对话 ${index + 1}`
            : `对话 ${index + 1}`;
    }
}