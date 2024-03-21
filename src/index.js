const { FtpSrv } = require('ftp-srv')
const { WikiFs } = require('./wiki-fs')

const startServer = async (options) => {
	const {
		backend: Backend = require('./backends/mediawiki').MediaWikiBackend,
		port = 21,
		url,
	} = options ?? {}

	const server = new FtpSrv({
		url: `ftp://0.0.0.0:${port}`,
	})

	server.on('login', async ({ username, password }, resolve, reject) => {
		try {
			const impl = new Backend()
			await impl.open({ url, username, password })
			resolve({ fs: new WikiFs(impl) })
		} catch (error) {
			reject(error)
		}
	})

	await server.listen(port)

	return async () => { await server.close() }
}

module.exports = { startServer }
