const { Redis } = require("@upstash/redis");

const redis = Redis.fromEnv();

const MAX_TIME = 60;
const MAX_REASONABLE_SCORE = 20000;

function cleanName(name) {

    if (typeof name !== "string") {
        return "PLAYER";
    }

    return name
        .trim()
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .slice(0, 24) || "PLAYER";
}


export default async function handler(req, res) {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {

        return res.status(200).end();

    }


    if (req.method !== "POST") {

        return res.status(405).json({
            error: "POST only"
        });

    }


    try {

        const body =
            typeof req.body === "string"
                ? JSON.parse(req.body)
                : req.body;


        const action =
            body?.action;


        /*
        =====================================================
        START RUN
        =====================================================
        */

        if (action === "start") {

            const runId =
                crypto.randomUUID();

            const startedAt =
                Date.now();


            /*
                Store server-side run start.

                This prevents a player from simply
                claiming that a 60 second run happened
                instantly.
            */

            await redis.set(
                `run:${runId}`,
                JSON.stringify({
                    startedAt,
                    used:false
                }),
                {
                    ex: 300
                }
            );


            return res.status(200).json({

                ok:true,

                runId

            });

        }


        /*
        =====================================================
        SUBMIT SCORE
        =====================================================
        */

        if (action === "submit") {

            const runId =
                String(body.runId || "");


            if (!runId) {

                return res.status(400).json({
                    error:"Missing run ID"
                });

            }


            const runKey =
                `run:${runId}`;


            const run =
                await redis.get(runKey);


            if (!run) {

                return res.status(400).json({
                    error:"Invalid or expired run"
                });

            }


            if (run.used) {

                return res.status(400).json({
                    error:"Run already submitted"
                });

            }


            /*
                Mark run as used BEFORE processing
                the score.
            */

            run.used = true;

            await redis.set(
                runKey,
                JSON.stringify(run),
                {
                    ex:60
                }
            );


            const now =
                Date.now();


            /*
                Server knows when run started.
            */

            const serverElapsed =
                (now-run.startedAt)/1000;


            /*
                Don't allow impossible timing.
            */

            if (
                serverElapsed < 0 ||
                serverElapsed > 70
            ) {

                return res.status(400).json({
                    error:"Invalid run duration"
                });

            }


            let score =
                Number(body.score);


            if (!Number.isFinite(score)) {

                return res.status(400).json({
                    error:"Invalid score"
                });

            }


            score =
                Math.floor(score);


            /*
                ABSOLUTE SCORE CAP

                This is intentionally generous enough
                for the actual game but prevents absurd
                numbers.
            */

            if (
                score < 0 ||
                score > MAX_REASONABLE_SCORE
            ) {

                return res.status(400).json({
                    error:"Impossible score"
                });

            }


            /*
                PHYSICAL SCORE CHECK

                The game gives approximately:

                    10 points / second
                    100 points / obstacle

                Server uses the actual server elapsed
                time to establish a theoretical maximum.

                We allow extra margin because the client
                can legitimately accumulate points during
                the final frame.
            */

            const theoreticalMax =
                Math.floor(
                    serverElapsed * 10
                ) +
                10000;


            if (
                score > theoreticalMax
            ) {

                return res.status(400).json({
                    error:"Score failed plausibility check"
                });

            }


            /*
                OPTIONAL PLAYER NAME

                Current frontend can use PLAYER.

                We still support names so the leaderboard
                can be upgraded without rebuilding the
                scoring system.
            */

            const name =
                cleanName(
                    body.name || "PLAYER"
                );


            const playerKey =
                `best:${name.toLowerCase()}`;


            const existing =
                await redis.get(playerKey);


            let personalBest =
                Number(existing || 0);


            /*
                ONLY HIGH SCORE SURVIVES.
            */

            if(score > personalBest){

                await redis.set(
                    playerKey,
                    score
                );

                personalBest =
                    score;

            }


            /*
                Global leaderboard.

                Redis sorted set:
                    score = ranking value
                    member = player name
            */

            await redis.zadd(
                "leaderboard",
                {
                    score:personalBest,
                    member:name
                }
            );


            return res.status(200).json({

                accepted:true,

                score,

                personalBest,

                message:
                    score >= personalBest
                    ? "Personal best saved"
                    : "Score recorded"

            });

        }


        /*
        =====================================================
        UNKNOWN ACTION
        =====================================================
        */

        return res.status(400).json({
            error:"Unknown action"
        });


    } catch(error) {

        console.error(error);

        return res.status(500).json({

            error:
                "Server error"

        });

    }

}
