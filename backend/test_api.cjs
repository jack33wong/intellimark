const axios = require('axios');

async function testApi() {
    const entryId = 'c4bc7f3e-97bd-4c04-a30d-c9b104e47518';
    const baseUrl = 'http://localhost:5001';

    try {
        console.log(`Fetching marking scheme ${entryId} from ${baseUrl}...`);
        const response = await axios.get(`${baseUrl}/api/admin/json/collections/markingSchemes/${entryId}`, {
            headers: {
                'Authorization': 'Bearer placeholder' 
            }
        });

        console.log('Response Status:', response.status);
        console.log('Data Questions Count:', response.data.entry?.questions?.length || 0);
        if (response.data.entry?.questions) {
            console.log('First 2 questions:', JSON.stringify(response.data.entry.questions.slice(0, 2), null, 2));
        }
    } catch (error) {
        if (error.response) {
            console.error('Error:', error.response.status, error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

testApi();
