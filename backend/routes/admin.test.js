const request = require('supertest');
const app = require('../server');

describe('Admin Routes', () => {
  test('GET /api/admin/past-papers should return empty array initially', async () => {
    const response = await request(app).get('/api/admin/past-papers');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });

  test('GET /api/admin/exam-boards should return empty array initially', async () => {
    const response = await request(app).get('/api/admin/exam-boards');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });

  test('GET /api/admin/years should return empty array initially', async () => {
    const response = await request(app).get('/api/admin/years');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });

  test('GET /api/admin/subjects should return empty array initially', async () => {
    const response = await request(app).get('/api/admin/subjects');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(0);
  });
});
