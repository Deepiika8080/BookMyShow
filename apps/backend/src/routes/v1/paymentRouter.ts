import { Router } from "express";
import { client } from "@repo/db/client";
import { redisClient } from "../../redis/worker.js";
import { processQueue } from "../../redis/worker.js";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { verifyJwt } from "../../controlleres/userController.js";
import Razorpay from "razorpay";
import crypto from "crypto";

dotenv.config();

interface Session {
    userId: string,
    movieId: string,
    status: string,
    expiresAt: number
}

export const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET
})

export const paymentRouter: Router = Router();


paymentRouter.post("/book", verifyJwt, async (req, res) => {
    try {
        const userId = req.id;
        const movieId = req.body.queueName;
        const amount = req.body.amount;
        const seats = req.body.seats;

        const movie = await client.movie.findFirst({
            where: {
                id: movieId
            }
        })

        if (!movie) {
            res.status(400).json({ message: "no movie found!!" });
            return;
        }

        const unavailableSeats = await client.seat.findMany({
            where: {
                seatNo: { in: seats },
                status: {
                    not: "available"
                }
            }
        })

        console.log("unavailableSeats", unavailableSeats);
        if (unavailableSeats.length > 0) {
            res.status(400).json({ message: "seats are already boooked!!" });
            return;
        }

        await redisClient.rPush(movieId, JSON.stringify({ userId, movieId, amount }));

        await processQueue(movieId, seats);

        res.status(200).json({ message: "order id created successfully" });

    } catch (error) {
        console.log("error", error);
        res.status(500).send("Error sending payment link.");
    }
});

paymentRouter.post("/verification", async (req, res) => {
    const SECRET = "kKmvVDMqrXZ4@2B";
    const { order_id, payment_id, status } = req.body.payload.payment.entity;
    const data = crypto.createHmac('sha256', SECRET)

    data.update(JSON.stringify(req.body))

    const digest = data.digest('hex');

    if (digest === req.headers['x-razorpay-signature']) {
        const data = await redisClient.get(`session:${order_id}`);
        if (data) {
            const session = await JSON.parse(data);

            if (session.expiresAt < Date.now()) {
                await client.payments.create({
                    data: {
                        id: payment_id,
                        paymentType: "failed",
                        orderId: order_id,
                        userId: session.userId
                    }
                })

                await client.seat.updateMany({
                    where: {
                        orderId: {
                            in: order_id
                        }
                    },
                    data: {
                        status: "available"
                    }
                })

            } else {
                await client.payments.create({
                    data: {
                        id: payment_id,
                        paymentType: "success",
                        orderId: order_id,
                        userId: session.userId
                    }
                })

                await client.seat.updateMany({
                    where: {
                        orderId: {
                            in: order_id
                        }
                    },
                    data: {
                        status: "booked"
                    }
                })
            }
        }
        res.json({
            status: 'ok'
        })
    } else {
        res.status(400).send('Invalid signature');

    }
})

const checkExpiredSessions = async () => {
    const sessionKeys = await redisClient.keys("session:*");
    for (const key in sessionKeys) {
        const sessionData = await redisClient.get(key);
        if (sessionData) {
            const session: Session = JSON.parse(sessionData);
            if (session.expiresAt < Date.now() && session.status === "pending") {
                await redisClient.del(key);
            }
        }
    }
}
