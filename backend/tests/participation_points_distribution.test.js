const mongoose = require('mongoose')
const supertest = require('supertest')
const app = require('../app')

const api = supertest(app)

const bcrypt = require('bcrypt')
const mockdate = require('mockdate')
const User = require('../models/user')
const Entry = require('../models/entry')
const { resetUserStreaks } = require('../utils/cronJobs')

let token
let userId
let originalPostId

describe('when a logged in user has not yet made any posts', () => {
	beforeEach(async () => {
		await User.deleteMany({})
		await Entry.deleteMany({})

		const passwordHash = await bcrypt.hash('test', 10)
		const initialUserData = {
			'username': 'test_user',
			'passwordHash': passwordHash,
			'first_name': 'testerson',
			'last_name': 'mctest',
			'email': 'mctest@gmail.com',
			'age': 1,
			'gender': 'Male',
			'weight': 175.3,
			'height': 1.7256
		}
		const user = new User(initialUserData)
		await user.save()
		userId = user._id
		const response = await api.post('/api/login').send({ username: 'test_user', password: 'test' })
		token = response.body.token

		const originalPost = new Entry({
			content: 'Original Post',
			user: userId,
			isTopLevel: true
		})
		await originalPost.save()
		originalPostId = originalPost._id
	}, 10000)


	test('consecutive posts correctly update streak, longest streak, last post date, and participation points ', async () => {
		// Post for day 1
		mockdate.set('2021-01-01')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 1' })

		// Post for day 2
		mockdate.set('2021-01-02')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 2' })
		const updatedUser = await User.findById(userId)

		expect(updatedUser.currentStreak).toBe(2)
		expect(updatedUser.longestStreak).toBe(2)
		expect(updatedUser.participation_points).toBe(2)
		expect(updatedUser.lastPostDate.getTime()).toBe(new Date().setHours(0,0,0,0))
	})

	test('creating multiple posts in one day increments participation points only once', async () => {
		// Post for day 1
		mockdate.set('2021-01-01')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 1' })

		// Post for day 1 again
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 2' })
		const updatedUser = await User.findById(userId)

		expect(updatedUser.currentStreak).toBe(1)
		expect(updatedUser.longestStreak).toBe(1)
		expect(updatedUser.participation_points).toBe(1)
		expect(updatedUser.lastPostDate.getTime()).toBe(new Date().setHours(0,0,0,0))
	})

	test('consecutive posts followed by a missed day followed by another post correctly update streak, longest streak, ' +
		'participation points and lastPostDate', async() => {
		mockdate.set('2021-01-01')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 1' })

		// Post for day 2
		mockdate.set('2021-01-02')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 2' })

		// Post for day 4
		mockdate.set('2021-01-04')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 2' })
		const updatedUser = await User.findById(userId)

		expect(updatedUser.currentStreak).toBe(1)
		expect(updatedUser.longestStreak).toBe(2)
		expect(updatedUser.participation_points).toBe(3)
		expect(updatedUser.lastPostDate.getTime()).toBe(new Date().setHours(0,0,0,0))
	})

	test('consecutive posts followed by a missed day causes cron job to correctly reset streak', async () => {
		// Post for day 1
		mockdate.set('2021-01-01')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 1' })
		await resetUserStreaks()
		let updatedUser = await User.findById(userId)
		expect(updatedUser.currentStreak).toBe(1)

		// Post for day 2
		mockdate.set('2021-01-02')
		await api.post('/api/entry').set('Authorization', `Bearer ${token}`).send({ content: 'Test post 2' })
		updatedUser = await User.findById(userId)
		await resetUserStreaks()
		expect(updatedUser.currentStreak).toBe(2)
		// Post for day 4
		mockdate.set('2021-01-04')
		await resetUserStreaks()
		updatedUser = await User.findById(userId)
		expect(updatedUser.currentStreak).toBe(0)
	})

	test('creating a reply updates participation points and streak', async () => {
		mockdate.set('2021-01-01')
		await api.post('/api/entry/reply')
			.set('Authorization', `Bearer ${token}`)
			.send({ content: 'Reply', id: originalPostId })
			.expect(200)

		const updatedUser = await User.findById(userId)
		expect(updatedUser.participation_points).toBe(1)
		expect(updatedUser.currentStreak).toBe(1)
	})

	test('post and reply on the same day increments participation points once each', async () => {
		mockdate.set('2021-01-02')
		await api
			.post('/api/entry')
			.set('Authorization', `Bearer ${token}`)
			.send({ content: 'Test post 3' } )
		await api
			.post('/api/entry/reply')
			.set('Authorization', `Bearer ${token}`)
			.send({ content: 'Reply', id: originalPostId })

		const updatedUser = await User.findById(userId)
		expect(updatedUser.participation_points).toBe(2)
		expect(updatedUser.currentStreak).toBe(1)
	})

	test('replying on consecutive days updates streak correctly', async () => {
		// Reply on day 1
		mockdate.set('2021-01-01')
		await api.post('/api/entry/reply')
			.set('Authorization', `Bearer ${token}`)
			.send({ content: 'Reply on day 1', entryId: originalPostId })

		// Reply on day 2
		mockdate.set('2021-01-02')
		await api.post('/api/entry/reply')
			.set('Authorization', `Bearer ${token}`)
			.send({ content: 'Reply on day 2', entryId: originalPostId })

		const updatedUser = await User.findById(userId)
		expect(updatedUser.currentStreak).toBe(2)
		expect(updatedUser.participation_points).toBe(2)
	})

	afterEach(async () => {
		mockdate.reset()
	})

	afterAll(async () => {
		await mongoose.connection.close()
	})
})