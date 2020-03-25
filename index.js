require("dotenv").config();
const app = require("express")();
const fs = require("fs");
const https = require("https").createServer(
	{
		key: fs.readFileSync("domain-key.pem"),
		cert: fs.readFileSync("domain-crt.pem")
	},
	app
);
const cors = require("cors");
const cron = require("node-cron");
const loadtest = require("loadtest");
const io = require("socket.io")(https);
const Pool = require("pg").Pool;
const pool = new Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	password: process.env.DB_PASSWORD,
	port: 5432
});
const signCheck = require("vkui-sign-checker");
const VkBot = require("node-vk-bot-api");

const bot = new VkBot(process.env.VK_BOT);

const maxSeconds = 10;
const testOptions = {
	url: "https://edu.stankin.ru",
	maxRequests: 2,
	maxSeconds
};

app.use(cors());
io.set("origins", "*:*");

io.on("connection", function(socket) {
	socket.on("auth", msg => {
		signCheck
			.check(msg.sign.slice(1), process.env.VK_SECURE)
			.then(res => {
				getTime().then(result => {
					socket.emit("times", result);
					getNotify(res.vk_user_id).then(res => {
						if (res) socket.emit("notify", res);
					});
				});
				socket.on("notify", function(msg) {
					createNotify(res.vk_user_id).then(() => {
						getNotify(res.vk_user_id).then(res => {
							socket.emit("notify", res);
						});
					});
				});
			})
			.catch(err => console.log(msg.sign, err));
	});
});

cron.schedule("*/5 * * * *", () => {
	check().then(() => {
		getTime().then(result => {
			io.emit("times", result);
			if (result[result.length - 1].loadtime < 10) sendMessages();
		});
	});
});

function check() {
	return new Promise((resolve, reject) =>
		loadtest.loadTest(testOptions, function(error, result) {
			const { totalTimeSeconds, totalRequests } = result;

			if (error || !totalRequests) {
				resolve(createTime(maxSeconds));
			}

			resolve(createTime(totalTimeSeconds / totalRequests));
		})
	);
}

function sendMessages() {
	getNotifyByTime().then(res => {
		res.map(person => {
			bot.sendMessage(
				person.id,
				"Сайт доступен!\nhttps://edu.stankin.ru"
			).then(err => {
				deleteNotify(person.id);
			});
		});
	});
}

function getTime() {
	return new Promise((resolve, reject) =>
		pool.query(
			" select * from (select trunc(loadtime,2) as loadtime, to_char(checktime, 'HH24.MI') as checktime from pings order by pings.checktime desc limit 6) as x order by x.checktime asc",
			[],
			(error, results) => {
				if (error) {
					return reject(error);
				}
				return resolve(results.rows);
			}
		)
	);
}

function createTime(time) {
	return new Promise((resolve, reject) =>
		pool.query(
			"INSERT INTO pings VALUES (DEFAULT, $1) ON CONFLICT DO NOTHING",
			[time],
			(error, results) => {
				if (error) {
					return reject(error);
				}
				return resolve(time);
			}
		)
	);
}

function createNotify(id) {
	return new Promise((resolve, reject) =>
		pool.query(
			"INSERT INTO alerts VALUES ($1, DEFAULT) ON CONFLICT (id) DO UPDATE SET start_time = DEFAULT",
			[id],
			(error, results) => {
				if (error) {
					return reject(error);
				}
				return resolve(results.rows);
			}
		)
	);
}

function getNotify(id) {
	return new Promise((resolve, reject) =>
		pool.query(
			"select *, to_char((start_time + interval '5 hours'), 'HH24.MI') as end_time from alerts where id = ($1)",
			[id],
			(error, results) => {
				if (error) {
					return reject(error);
				}
				return resolve(results.rows[0]);
			}
		)
	);
}

function getNotifyByTime() {
	return new Promise((resolve, reject) =>
		pool.query(
			"select * from alerts where  start_time + interval '5 hours' <= (now() + interval '5 hours')",
			[],
			(error, results) => {
				if (error) {
					return reject(error);
				}
				return resolve(results.rows);
			}
		)
	);
}

function deleteNotify(id) {
	return new Promise((resolve, reject) =>
		pool.query(
			"DELETE FROM alerts where id = ($1)",
			[id],
			(error, results) => {
				if (error) {
					return reject(error);
				}
				return resolve(results.rows);
			}
		)
	);
}

https.listen(process.env.PORT);
