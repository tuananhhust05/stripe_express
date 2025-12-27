const axios = require('axios');

// Target endpoints for proxy
const ENDPOINTS = [
  'http://3.106.56.62:5000/crawl',
  'http://46.62.235.145:5000/crawl'
];

/**
 * Search by image - proxy request to external crawl endpoints
 * POST /api/search_by_image
 * Body: { "image_url": "https://..." }
 */
const searchByImage = async (req, res) => {
  try {
    const { image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({
        success: false,
        error: 'image_url is required'
      });
    }

    // Validate URL format
    try {
      new URL(image_url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid image_url format'
      });
    }

    console.log('🔍 [search_by_image] Searching for image:', image_url);

    // Send requests to both endpoints in parallel
    const requests = ENDPOINTS.map(endpoint => 
      axios.post(endpoint, { image_url }, {
        headers: {
          'Content-Type': 'application/json'
        }
        // No timeout - wait indefinitely for response
      }).then(response => ({
        endpoint,
        success: true,
        data: response.data,
        status: response.status
      })).catch(error => ({
        endpoint,
        success: false,
        error: error.message,
        status: error.response?.status || 500
      }))
    );

    // Wait for all requests to complete
    const results = await Promise.allSettled(requests);

    // Process results
    const responses = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          endpoint: ENDPOINTS[index],
          success: false,
          error: result.reason?.message || 'Request failed',
          status: 500
        };
      }
    });

    // Find first successful response
    const successfulResponse = responses.find(r => r.success);

    if (successfulResponse) {
      console.log('✅ [search_by_image] Success from:', successfulResponse.endpoint);
      return res.json({
        success: true,
        data: successfulResponse.data,
        source: successfulResponse.endpoint,
        all_responses: responses
      });
    } else {
      // All requests failed
      console.error('❌ [search_by_image] All endpoints failed');
      return res.status(500).json({
        success: false,
        error: 'All crawl endpoints failed',
        responses: responses
      });
    }
  } catch (error) {
    console.error('❌ [search_by_image] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
};

module.exports = {
  searchByImage
};

