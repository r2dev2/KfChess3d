const url = end => `https://nicenotifier.r2dev2bb8.repl.co${end}`;
// ping message has data of send timestamp
export const PING = 0;

// move message has data of [piece, file, rank]
export const MOVE = 1;

export class Network {
    #channel;
    #listeners;

    constructor(joinCode) {
        this.#channel = `kfchess-${joinCode}`;
        this.#listeners = [];

        // ping every 5s to keep replit up and running
        setInterval(() => this.#sendMessage([PING, [Date.now()]]), 5000);

        const events = new EventSource(url(`/events/${this.#channel}`));
        events.addEventListener('message', msg => {
            this.#listeners.forEach(cb => cb(msg));
        });

        this.onMessage(PING, time => console.log('PING', Date.now() - time, 'ms'));
    }

    // usage:
    // >>> network.sendMessage(MOVE, [WHITE_PAWN, 'e', 4])
    sendMessage(type, args) {
        this.#sendMessage([type, args]);
    }

    // usage:
    // >>> network.onMessage(MOVE, (piece, file, rank) => ...);
    onMessage(type, cb) {
        this.#listeners.push(msg => {
            msg = JSON.parse(msg.data);
            if (msg[0] === type) {
                cb(...msg[1]);
            }
        });
    }

    async #sendMessage(msg) {
        return await fetch(url('/broadcast'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channel: this.#channel,
                msg: JSON.stringify(msg)
            })
        });
    }
}
