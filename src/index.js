const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { BullMQAdapter } = require('@bull-board/api//bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const Queue = require('bull');
const bullmq = require('bullmq');
const express = require('express');
const redis = require('redis');
const session = require('express-session');
const passport = require('passport');
const { ensureLoggedIn } = require('connect-ensure-login');
const bodyParser = require('body-parser');

const { authRouter } = require('./login');
const config = require('./config');

const redisConfig = {
	redis: {
		port: config.REDIS_PORT,
		host: config.REDIS_HOST,
		tls: {
			servername: config.REDIS_HOST
		}
	},
};

const bullconfig = {
	redis: {
		host: config.REDIS_HOST,
		port: config.REDIS_PORT,
		password: config.REDIS_PASSWORD,
		username: config.REDIS_USERNAME,
		tls: {
			servername: config.REDIS_HOST,
		}
	}
};

const serverAdapter = new ExpressAdapter();
const client = redis.createClient(redisConfig.redis);
client.send_command('AUTH', [config.REDIS_PASSWORD, config.REDIS_USERNAME]);
const { setQueues } = createBullBoard({ queues: [], serverAdapter });
const router = serverAdapter.getRouter();

client.KEYS(`${config.BULL_PREFIX}:*`, (err, keys) => {
	const uniqKeys = new Set(keys.map(key => key.replace(/^.+?:(.+?):.+?$/, '$1')));
	const queueList = Array.from(uniqKeys).sort().map(
		(item) => {
			if (config.BULL_VERSION === 'BULLMQ') {
				return new BullMQAdapter(new bullmq.Queue(item, { connection: bullconfig.redis }));
			}

			return new BullAdapter(new Queue(item, bullconfig));
		}
	);

	setQueues(queueList);
	console.log('done!')
});

const app = express();

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

if (app.get('env') !== 'production') {
	const morgan = require('morgan');
	app.use(morgan('combined'));
}

app.use((req, res, next) => {
	if (config.PROXY_PATH) {
		req.proxyUrl = config.PROXY_PATH;
	}

	next();
});

const sessionOpts = {
	name: 'bull-board.sid',
	secret: Math.random().toString(),
	resave: false,
	saveUninitialized: false,
	cookie: {
		path: '/',
		httpOnly: false,
		secure: false
	}
};

app.use(session(sessionOpts));
app.use(passport.initialize({}));
app.use(passport.session({}));
app.use(bodyParser.urlencoded({ extended: false }));

if (config.AUTH_ENABLED) {
	app.use(config.LOGIN_PAGE, authRouter);
	app.use(config.HOME_PAGE, ensureLoggedIn(config.LOGIN_PAGE), router);
} else {
	app.use(config.HOME_PAGE, router);
}

app.listen(config.PORT, () => {
	console.log(`bull-board is started http://localhost:${config.PORT}${config.HOME_PAGE}`);
	console.log(`bull-board is fetching queue list, please wait...`);
});
