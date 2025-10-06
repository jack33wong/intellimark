/**
 * A dedicated utility to house the complex logic for merging local session state
 * with new data from the server, ensuring data consistency.
 */
export const mergeSessionData = (localSession, newSessionFromServer, modelUsed = null) => {
    // Start with the new, authoritative data from the server.
    let mergedSession = { ...newSessionFromServer };

    // Merge metadata to fix the "N/A" bug, correctly prioritizing the server's data.
    const localMeta = localSession?.sessionStats || {};
    const serverMeta = newSessionFromServer.sessionStats || {};
    mergedSession.sessionStats = {
        ...localMeta,
        ...serverMeta,
        lastModelUsed: serverMeta.lastModelUsed || modelUsed || serverMeta.lastModelUsed || localMeta.lastModelUsed || 'N/A'
    };

    // Preserve the local `imageData` for ALL optimistic user messages in the session.
    if (localSession?.messages && mergedSession.messages) {
        // 1. Create a map of all local user images that have imageData.
        const optimisticImageMap = new Map();
        localSession.messages.forEach(msg => {
            // 👇 FIX: The condition is now correct. It captures imageData from ANY local
            // user message, not just those without an imageLink. This ensures all
            // previous images are preserved, not just the most recent one.
            if (msg.role === 'user' && msg.imageData) {
                optimisticImageMap.set(msg.content, msg.imageData);
            }
        });

        if (optimisticImageMap.size > 0) {
            // 2. For each message from the server...
            mergedSession.messages = mergedSession.messages.map(serverMessage => {
                // ...if its content exists in our map...
                if (serverMessage.role === 'user' && optimisticImageMap.has(serverMessage.content)) {
                    // ...copy the local imageData over to prevent the refresh.
                    return { ...serverMessage, imageData: optimisticImageMap.get(serverMessage.content) };
                }
                // Otherwise, return the server message as is.
                return serverMessage;
            });
        }
    }

    return mergedSession;
};

