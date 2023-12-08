import { defs, tiny } from './examples/common.js';
import { Shape_From_File } from './examples/obj-file-demo.js';
import { MousePicker } from './mouse_pick.js';
import { Cooldown_Shader } from './shaders.js';
import { Network, MOVE } from './network.js';

const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene, Texture
} = tiny;

const PIECE_VELOCITY = 2;
const PIECE_HEIGHT = 2;
const PIECE_RADIUS = 1;
const IDLE = 0, MOVING = 1, EATEN = 2;
const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;
const COOLDOWN = 5;

class Piece {
    constructor(shape, file, rank, piece_color, translation = 0, scale = 1, piece = PAWN) {
        this.shape = shape;
        this.translation = translation;
        this.scale = scale;

        this.rank = rank - 1;
        this.file = file.charCodeAt(0) - 'a'.charCodeAt(0);
        this.flip = 1;
        if (piece_color === "black")
            this.flip = -1;

        // chess piece state variable
        this.state = {
            mode: IDLE,
            old_p: [-this.file * 2.4, this.translation, this.rank * 2.4],
            curr_p: [-this.file * 2.4, this.translation, this.rank * 2.4],
            dest_p: [0, this.translation, 0],
            v: [0, 0, 0],
            a: 0,
            start_t: 0,
            cooldown_left: 0
        }

        this.model_transform = Mat4.identity();
        this.model_transform = this.model_transform.times(Mat4.translation(-this.file * 2.4, this.translation, this.rank * 2.4).times(Mat4.scale(this.scale, this.scale, this.scale * this.flip)));
        this.alive = 1;

        this.piece = piece;

    }

    move_to(file, rank, t) {
        // computes and sets relevant variables for piece movement
        // uses constant PIECE_VELOCITY and PIECE_HEIGHT to determine velocity in x, y, z and acceleration in y

        // convert file and rank to x, z coordinates
        console.log(file, rank, this.file, this.rank)
        let [src_x, src_z] = this.to_coords(this.file, this.rank);
        let [tgt_x, tgt_z] = this.to_coords(file, rank);

        // update piece file and rank to destination (TODO fix if need different behavior)
        this.file = file;
        this.rank = rank;

        this.state.dest_p[0] = tgt_x;
        this.state.dest_p[2] = tgt_z;

        let d_x = (tgt_x - src_x);
        let d_z = (tgt_z - src_z);
        let v_x = PIECE_VELOCITY * (d_x / Math.sqrt(d_x ** 2 + d_z ** 2));
        let v_z = PIECE_VELOCITY * (d_z / Math.sqrt(d_x ** 2 + d_z ** 2));

        let animation_time = Math.sqrt(d_x ** 2 + d_z ** 2) / PIECE_VELOCITY;

        this.state.a = 8 * PIECE_HEIGHT / (animation_time ** 2);

        this.state.v = [v_x, this.state.a * animation_time / 2, v_z];
        this.state.start_t = t;
        this.state.mode = MOVING;
    }

    to_coords(file, rank) { return [-file * 2.4, rank * 2.4]; } // converts file and rank to x, z coordinates

    compute_transform(t) {
        // if piece is moving, computes the translation matrix at time t, otherwise return model_transform

        if (this.state.mode !== MOVING) return this.model_transform;

        // dt = time since piece started moving
        let dt = t - this.state.start_t;

        // stop piece movement once ∆y < 0
        if ((this.state.v[1] - this.state.a * dt / 2) * dt < 0) {
            this.state.mode = IDLE;
            // set model_transform to destination position
            this.model_transform = Mat4.translation(this.state.dest_p[0] - this.state.old_p[0], 0, this.state.dest_p[2] - this.state.old_p[2]).times(this.model_transform);
            // update old and current position to destination position
            this.state.old_p = [...this.state.dest_p];
            this.state.curr_p = [...this.state.dest_p];
            // reset velocity and acceleration
            this.state.v = [0, 0, 0];
            this.state.a = 0;
            this.state.cooldown_left = COOLDOWN;
            return this.model_transform;
        }

        // update current position based on old position, velocity, and acceleration
        this.state.curr_p[0] = this.state.old_p[0] + this.state.v[0] * dt;
        this.state.curr_p[1] = this.state.old_p[1] + (this.state.v[1] - this.state.a * dt / 2) * dt;
        this.state.curr_p[2] = this.state.old_p[2] + this.state.v[2] * dt;

        // return translation matrix
        return Mat4.translation(this.state.v[0] * dt, (this.state.v[1] - this.state.a * dt / 2) * dt, this.state.v[2] * dt).times(this.model_transform);
    }

    kill() {
        this.state.mode = EATEN;
    }

    getCooldown() {
        return this.state.cooldown_left / COOLDOWN;
    }

    updateCooldown(dt) {
        if (this.state.cooldown_left <= 0) {
            this.state.cooldown_left = 0;
            return;
        }
        this.state.cooldown_left -= dt;
    }

}


const rng = () => Math.random().toString(16).slice(2);
const rngid = rng() + rng();

// white sends out the link and will therefore not have id param set
const params = new URLSearchParams(location.search);
const id = params.get('id') ?? rngid;
const isWhite = !params.get('id');

// access network object with network
window.network = new Network(`kfchess-${id}`);

// kfchess theme music
window.kfaudio = new Audio('./assets/kfchess.mp3');
kfaudio.loop = true;
const kfstart = () => {
    if (!localStorage.getItem('disable')) {
        kfaudio.play();
    }
    window.removeEventListener('click', kfstart);
}
window.addEventListener('click', kfstart);

let objId = 1;
const objMap = new Map();
class GridSquare {
    // file and rank are in [0, 7]
    // file is like a-h
    // rank is like 0-7
    #file;
    #rank;

    // the shape and material of the cube
    #shape;
    #material;

    // unique object id
    id;

    constructor(file, rank) {
        this.#file = file;
        this.#rank = rank;
        this.#shape = new defs.Cube();
        this.#material = new Material(new defs.Phong_Shader(),
            { ambient: 1, diffusivity: 0, specularity: 0, color: hex_color('#000000') });
        this.id = objId++;

        // register this object with the global object map
        objMap.set(this.id, this);
    }

    drawOverride(ctx, prog_state, override) {
        const transform = Mat4.translation(
                2.4 * ((7 - this.#file) + 1) - 19.2, -1.5, 2.4 * this.#rank
            )
            .times(Mat4.scale(1.2, 0.1, 1.2));
        const white = hex_color('#ffffff');
        const black = hex_color('#000000');
        const material = this.#material.override({
            color: (this.#file + this.#rank) % 2 == 0 ? white : black,
            ...override
        });
        this.#shape.draw(ctx, prog_state, transform, material);
    }

    toString() {
        const files = 'abcdefgh';
        return `Grid(${files[this.#file]}${this.#rank + 1})`;
    }

    getFile() { return this.#file; }

    getRank() { return this.#rank; }
}

export class Chess extends Scene {
    constructor() {
        // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
        super();

        this.player = isWhite ? 0 : 1;

        // At the beginning of our program, load one of each of these shape definitions onto the GPU.
        this.shapes = {
            white_king: new Shape_From_File('assets/chess/White_King.obj'),
            white_queen: new Shape_From_File('assets/chess/White_Queen.obj'),
            white_knight: new Shape_From_File('assets/chess/White_Knight.obj'),
            white_bishop: new Shape_From_File('assets/chess/White_Bishop.obj'),
            white_rook: new Shape_From_File('assets/chess/White_Rook.obj'),
            white_pawn: new Shape_From_File('assets/chess/White_Pawn.obj'),
            grid: new defs.Cube(),
            walls: new defs.Cube()
        };

        this.white_pieces = [
            new Piece(this.shapes.white_rook, 'a', 1, "white", -0.3, 1, ROOK),
            new Piece(this.shapes.white_knight, 'b', 1, "white", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_bishop, 'c', 1, "white", 0, 1, BISHOP),
            new Piece(this.shapes.white_queen, 'd', 1, "white", 0, 1, QUEEN),
            new Piece(this.shapes.white_king, 'e', 1, "white", -0.3, 1, KING),
            new Piece(this.shapes.white_bishop, 'f', 1, "white", 0, 1, BISHOP),
            new Piece(this.shapes.white_knight, 'g', 1, "white", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_rook, 'h', 1, "white", -0.3, 1, ROOK),
            new Piece(this.shapes.white_pawn, 'a', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'b', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'c', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'd', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'e', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'f', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'g', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'h', 2, "white", -0.6, 0.6),
        ];

        this.black_pieces = [
            new Piece(this.shapes.white_rook, 'a', 8, "black", -0.3, 1, ROOK),
            new Piece(this.shapes.white_knight, 'b', 8, "black", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_bishop, 'c', 8, "black", 0, 1, BISHOP),
            new Piece(this.shapes.white_queen, 'd', 8, "black", 0, 1, QUEEN),
            new Piece(this.shapes.white_king, 'e', 8, "black", -0.3, 1, KING),
            new Piece(this.shapes.white_bishop, 'f', 8, "black", 0, 1, BISHOP),
            new Piece(this.shapes.white_knight, 'g', 8, "black", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_rook, 'h', 8, "black", -0.3, 1, ROOK),
            new Piece(this.shapes.white_pawn, 'a', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'b', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'c', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'd', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'e', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'f', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'g', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'h', 7, "black", -0.6, 0.6),
        ];

        // *** Materials
        this.materials = {
            piece: new Material(new Cooldown_Shader(),
                { ambient: .4, diffusivity: .6, specularity: 0.2, color: hex_color("#ffffff"), texture: new Texture("assets/lee.jpg"), cooldown: 0. }),
            grid: new Material(new defs.Phong_Shader(),
                { ambient: .4, diffusivity: .6, specularity: 0.2, color: hex_color("#000000") }),
            top: new Material(new defs.Textured_Phong(),
            { ambient: 0.4, diffusivity: 1, color: hex_color("#ffffff"), texture: new Texture("assets/background/top.png") }),
            right: new Material(new defs.Textured_Phong(),
            { ambient: 0.4, diffusivity: 1, color: hex_color("#ffffff"), texture: new Texture("assets/background/right.png") }),
            left: new Material(new defs.Textured_Phong(),
            { ambient: 0.4, diffusivity: 1, color: hex_color("#ffffff"), texture: new Texture("assets/background/left.png") }),
            bottom: new Material(new defs.Textured_Phong(),
            { ambient: 0.4, diffusivity: 1, color: hex_color("#ffffff"), texture: new Texture("assets/background/bottom.png") }),
            front: new Material(new defs.Textured_Phong(),
            { ambient: 0.4, diffusivity: 1, color: hex_color("#ffffff"), texture: new Texture("assets/background/front.png") }),
            back: new Material(new defs.Textured_Phong(),
            { ambient: 0.4, diffusivity: 1, color: hex_color("#ffffff"), texture: new Texture("assets/background/back.png") }),

        }

        this.tracked = []
        for (let file = 0; file < 8; ++file) {
            for (let rank = 0; rank < 8; ++rank) {
                this.tracked.push(new GridSquare(file, rank));
            };
        };

        // ex. "Grid(c5)"
        this.selected_square = "";
        this.destination_square = "";

        // push -> this.moveQueue.push()
        // pop -> this.moveQueue.shift(1)
        // ex. [{ from_: 'e2', to: 'e4' }]
        // note that from is a reserved keyword in js so wanna stay away
        /** @type {{ from_: string, to: string }[]} */
        this.moveQueue = [];

        this.picker = new MousePicker(this);
        this.picker.onClicked((obj) => {
            if (obj !== null) {
                console.log(obj, objMap.get(obj).toString(), 'clicked');
                let str = objMap.get(obj).toString();
                if (this.selected_square === "") {
                    const piece = this.piece_at(str.charCodeAt(5) - 'a'.charCodeAt(0), (str.charCodeAt(6) - '0'.charCodeAt(0)) - 1);
                    const piece_obj = this.get_piece(str.charCodeAt(5) - 'a'.charCodeAt(0), (str.charCodeAt(6) - '0'.charCodeAt(0)) - 1)
                    if ((isWhite && piece > 0 || !isWhite && piece < 0) && piece_obj.state.cooldown_left <= 0) {
                        this.selected_square = str;
                    }
                }
                else if (this.selected_square === str) {
                    this.selected_square = "";
                }
                else {
                    console.log("Move: ", this.selected_square, str);
                    console.log(this.board);
                    network.sendMessage(MOVE, [this.selected_square, str]);
                    this.selected_square = '';
                }
            }
        });

        network.onMessage(MOVE, (from_, to) => {
            this.moveQueue.push({ from_, to });
        });

        this.initial_camera_location = Mat4.look_at(vec3(0, 10, 20), vec3(0, 0, 0), vec3(0, 1, 0));

        this.board = [[0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0]];

        this.white_pieces.forEach((p, i) => {
            this.board[p.file][p.rank] = p.piece * p.flip;
        });

        this.black_pieces.forEach((p, i) => {
            this.board[p.file][p.rank] =  p.piece * p.flip;
        });

        // initial position to test code
        // this.move('e', 2, 'e', 4);
        // console.log(this.board);
        // this.move('d', 7, 'd', 5);
        // // this.move('e', 4, 'd', 5);
        // this.move('e', 4, 'd', 5);
        // this.move('d', 8, 'd', 5);
        // this.move('d', 1, 'c', 2);
        // console.log(this.can_move_knight(this.white_pieces[6], 'f', 5));
    }

    reset_board() {
        this.white_pieces = [
            new Piece(this.shapes.white_rook, 'a', 1, "white", -0.3, 1, ROOK),
            new Piece(this.shapes.white_knight, 'b', 1, "white", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_bishop, 'c', 1, "white", 0, 1, BISHOP),
            new Piece(this.shapes.white_queen, 'd', 1, "white", 0, 1, QUEEN),
            new Piece(this.shapes.white_king, 'e', 1, "white", -0.3, 1, KING),
            new Piece(this.shapes.white_bishop, 'f', 1, "white", 0, 1, BISHOP),
            new Piece(this.shapes.white_knight, 'g', 1, "white", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_rook, 'h', 1, "white", -0.3, 1, ROOK),
            new Piece(this.shapes.white_pawn, 'a', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'b', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'c', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'd', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'e', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'f', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'g', 2, "white", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'h', 2, "white", -0.6, 0.6),
        ];

        this.black_pieces = [
            new Piece(this.shapes.white_rook, 'a', 8, "black", -0.3, 1, ROOK),
            new Piece(this.shapes.white_knight, 'b', 8, "black", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_bishop, 'c', 8, "black", 0, 1, BISHOP),
            new Piece(this.shapes.white_queen, 'd', 8, "black", 0, 1, QUEEN),
            new Piece(this.shapes.white_king, 'e', 8, "black", -0.3, 1, KING),
            new Piece(this.shapes.white_bishop, 'f', 8, "black", 0, 1, BISHOP),
            new Piece(this.shapes.white_knight, 'g', 8, "black", -0.8, 0.5, KNIGHT),
            new Piece(this.shapes.white_rook, 'h', 8, "black", -0.3, 1, ROOK),
            new Piece(this.shapes.white_pawn, 'a', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'b', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'c', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'd', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'e', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'f', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'g', 7, "black", -0.6, 0.6),
            new Piece(this.shapes.white_pawn, 'h', 7, "black", -0.6, 0.6),
        ];

        this.board = [[0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0]];

        this.white_pieces.forEach((p, i) => {
            this.board[p.file][p.rank] = p.piece * p.flip;
        });

        this.black_pieces.forEach((p, i) => {
            this.board[p.file][p.rank] =  p.piece * p.flip;
        });


    }

    make_control_panel() {
        // Draw the scene's buttons, setup their actions and keyboard shortcuts, and monitor live measurements.
        if (isWhite) {
            this.key_triggered_button('Copy Join Link', ['Control', 'j'], () => {
                const join = new URL(location);
                join.searchParams.set('id', id);
                navigator.clipboard.writeText(join.toString());
            });
            this.new_line();
        }
        this.key_triggered_button("Reset Game", ["Control", "0"], () => this.reset_board());
        this.new_line();
        this.key_triggered_button("Play as White", ["Control", "1"], () => this.player = 0);
        this.key_triggered_button("Play as Black", ["Control", "2"], () => this.player = 1);
    }

    // uses numbers
    is_valid_square(file, rank) {
        return !(file < 0 || file > 7 || rank < 0 || rank > 7);
    }

    // checks if there's a non-moving piece at the given square
    // returns false if the square is not valid
    // uses numbers
    //
    // piece_at(...) > 0  => white
    // piece_at(...) < 0  => black
    // piece_at(...) == 0 => no piece
    piece_at(file, rank) {
        if (file < 0 || file > 7 || rank < 0 || rank > 7) {
            return 0;
        }
        return this.board[file][rank];
    }

    check_piece_at(file, rank, color) {
        let possible = false;
        if (color === 1) {
            this.white_pieces.forEach((piece) => {
                if (piece.state.mode === EATEN) {
                    return;
                }
                if (piece.file === file && piece.rank === rank) {
                    possible = true;
                }
            })
        }
        else {
            this.black_pieces.forEach((piece) => {
                if (piece.state.mode === EATEN) {
                    return;
                }
                if (piece.file === file && piece.rank === rank) {
                    possible = true;
                }
            })
        }
        return possible;
    }

    // all the can move functions use letter and number like can_move_pawn(pawn, "e", 4)
    // requirement: passes in a pawn
    can_move_pawn(piece, end_file, end_rank) {

        // convert to correct integer indices
        end_file = end_file.charCodeAt(0) - 'a'.charCodeAt(0);
        end_rank--;

        let [file, rank] = [piece.file, piece.rank];

        let possible_moves = [];
        if (piece.flip === 1) {

            if (rank < 7 && !this.piece_at(file, rank + 1) && !this.check_piece_at(file, rank + 1, piece.flip)) {
                possible_moves.push([file, rank + 1]);

                if (rank === 1) {
                    if (!this.piece_at(file, rank + 2) && !this.check_piece_at(file, rank + 2, piece.flip)) {
                        possible_moves.push([file, rank + 2]);
                    }
                }
            }

            for (let i = file - 1; i <= file + 1; i+=2) {
                if (this.piece_at(i, rank + 1) && !this.check_piece_at(i, rank + 1, piece.flip)) {
                    possible_moves.push([i, rank + 1]);
                }
            }
        }
        else {
            // double if at initial position



            if (rank > 0 && !this.piece_at(file, rank - 1) && !this.check_piece_at(file, rank - 1, piece.flip)) {
                possible_moves.push([file, rank - 1]);

                if (rank === 6) {
                    if (!this.piece_at(file, rank - 2) && !this.check_piece_at(file, rank - 2, piece.flip)) {
                        possible_moves.push([file, rank - 2]);
                    }
                }
            }

            for (let i = file - 1; i <= file + 1; i+=2) {
                if (this.piece_at(i, rank - 1) && !this.check_piece_at(i, rank - 1, piece.flip)) {
                    possible_moves.push([i, rank - 1]);
                }
            }
        }

        console.log(possible_moves);
        let possible = false;
        possible_moves.forEach((move) => {
            if (move[0] === end_file && move[1] === end_rank) {
                possible = true;
            }
        });


        return possible;
    }

    can_move_knight(piece, end_file, end_rank) {

        // convert to correct integer indices
        end_file = end_file.charCodeAt(0) - 'a'.charCodeAt(0);
        end_rank--;

        let [file, rank] = [piece.file, piece.rank];


        let possible_moves = [];
        let d = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

        // double if at initial position
        d.forEach((square) => {
            if (!this.is_valid_square(file + square[0], rank + square[1])) {
                return;
            }
            if (piece.flip === 1 && this.piece_at(file + square[0], rank + square[1]) <= 0 && !this.check_piece_at(file + square[0], rank + square[1], piece.flip)) {
                possible_moves.push([file + square[0], rank + square[1]]);
            }
            else if (piece.flip === -1 && this.piece_at(file + square[0], rank + square[1]) >= 0 && !this.check_piece_at(file + square[0], rank + square[1], piece.flip)) {
                possible_moves.push([file + square[0], rank + square[1]]);
            }
        })

        let possible = false;
        possible_moves.forEach((move) => {
            if (move[0] === end_file && move[1] === end_rank) {
                possible = true;
            }
        });

        return possible;
    }

    can_move_bishop(piece, end_file, end_rank) {

        // convert to correct integer indices
        end_file = end_file.charCodeAt(0) - 'a'.charCodeAt(0);
        end_rank--;

        let [file, rank] = [piece.file, piece.rank];


        let possible_moves = [];
        for (let d = -1; d >= -7; d--) {
            if (!this.is_valid_square(file + d, rank + d)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file + d, rank + d) <= 0 && !this.check_piece_at(file + d, rank + d, piece.flip)) {
                possible_moves.push([file + d, rank + d]);

            }

            if (piece.flip === -1 && this.piece_at(file + d, rank + d) >= 0 && !this.check_piece_at(file + d, rank + d, piece.flip)) {
                possible_moves.push([file + d, rank + d]);

            }

            if (this.piece_at(file + d, rank + d) !== 0 && !this.check_piece_at(file + d, rank + d, piece.flip)) {
                break;
            }
        }

        for (let d = 1; d <= 7; d++) {
            if (!this.is_valid_square(file + d, rank + d)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file + d, rank + d) <= 0 && !this.check_piece_at(file + d, rank + d, piece.flip)) {
                possible_moves.push([file + d, rank + d]);

            }

            if (piece.flip === -1 && this.piece_at(file + d, rank + d) >= 0 && !this.check_piece_at(file + d, rank + d, piece.flip)) {
                possible_moves.push([file + d, rank + d]);

            }

            if (this.piece_at(file + d, rank + d) !== 0 && !this.check_piece_at(file + d, rank + d, piece.flip)) {
                break;
            }
        }

        for (let d = -1; d >= -7; d--) {
            if (!this.is_valid_square(file + d, rank - d)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file + d, rank - d) <= 0 && !this.check_piece_at(file + d, rank - d, piece.flip)) {
                possible_moves.push([file + d, rank - d]);

            }

            if (piece.flip === -1 && this.piece_at(file + d, rank - d) >= 0 && !this.check_piece_at(file + d, rank - d, piece.flip)) {
                possible_moves.push([file + d, rank - d]);

            }

            if (this.piece_at(file + d, rank - d) !== 0 && !this.check_piece_at(file + d, rank - d, piece.flip)) {
                break;
            }

        }

        for (let d = 1; d <= 7; d++) {
            if (!this.is_valid_square(file + d, rank - d)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file + d, rank - d) <= 0 && !this.check_piece_at(file + d, rank - d, piece.flip)) {
                possible_moves.push([file + d, rank - d]);

            }

            if (piece.flip === -1 && this.piece_at(file + d, rank - d) >= 0 && !this.check_piece_at(file + d, rank - d, piece.flip)) {
                possible_moves.push([file + d, rank - d]);

            }

            if (this.piece_at(file + d, rank - d) !== 0 && !this.check_piece_at(file + d, rank - d, piece.flip)) {
                break;
            }

        }

        let possible = false;
        possible_moves.forEach((move) => {
            if (move[0] === end_file && move[1] === end_rank) {
                possible = true;
            }
        });

        return possible;
    }

    can_move_rook(piece, end_file, end_rank) {

        // convert to correct integer indices
        end_file = end_file.charCodeAt(0) - 'a'.charCodeAt(0);
        end_rank--;

        let [file, rank] = [piece.file, piece.rank];


        let possible_moves = [];
        for (let d = -1; d >= -7; d--) {
            if (!this.is_valid_square(file + d, rank)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file + d, rank) <= 0 && !this.check_piece_at(file + d, rank, piece.flip)) {
                possible_moves.push([file + d, rank]);

            }

            if (piece.flip === -1 && this.piece_at(file + d, rank) >= 0 && !this.check_piece_at(file + d, rank, piece.flip)) {
                possible_moves.push([file + d, rank]);

            }

            if (this.piece_at(file + d, rank) !== 0 && !this.check_piece_at(file + d, rank, piece.flip)) {
                break;
            }
        }

        for (let d = 1; d <= 7; d++) {
            if (!this.is_valid_square(file + d, rank)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file + d, rank) <= 0 && !this.check_piece_at(file + d, rank, piece.flip)) {
                possible_moves.push([file + d, rank]);

            }

            if (piece.flip === -1 && this.piece_at(file + d, rank) >= 0 && !this.check_piece_at(file + d, rank, piece.flip)) {
                possible_moves.push([file + d, rank]);

            }

            if (this.piece_at(file + d, rank) !== 0 && !this.check_piece_at(file + d, rank, piece.flip)) {
                break;
            }
        }

        for (let d = -1; d >= -7; d--) {
            if (!this.is_valid_square(file, rank + d)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file, rank + d) <= 0 && !this.check_piece_at(file, rank + d, piece.flip)) {
                possible_moves.push([file, rank + d]);

            }

            if (piece.flip === -1 && this.piece_at(file, rank + d) >= 0 && !this.check_piece_at(file, rank + d, piece.flip)) {
                possible_moves.push([file, rank + d]);

            }

            if (this.piece_at(file, rank + d) !== 0 && !this.check_piece_at(file, rank + d, piece.flip)) {
                break;
            }

        }

        for (let d = 1; d <= 7; d++) {
            if (!this.is_valid_square(file, rank + d)) {
                break;
            }

            if (piece.flip === 1 && this.piece_at(file, rank + d) <= 0 && !this.check_piece_at(file, rank + d, piece.flip)) {
                possible_moves.push([file, rank + d]);

            }

            if (piece.flip === -1 && this.piece_at(file, rank + d) >= 0 && !this.check_piece_at(file, rank + d, piece.flip)) {
                possible_moves.push([file, rank + d]);

            }

            if (this.piece_at(file, rank + d) !== 0 && !this.check_piece_at(file, rank + d, piece.flip)) {
                break;
            }

        }


        let possible = false;
        possible_moves.forEach((move) => {
            if (move[0] === end_file && move[1] === end_rank) {
                possible = true;
            }
        });

        return possible;
    }

    can_move_queen(piece, end_file, end_rank) {
        console.log(piece);
        return this.can_move_rook(piece, end_file, end_rank) || this.can_move_bishop(piece, end_file, end_rank);
    }

    can_move_king(piece, end_file, end_rank) {

        // convert to correct integer indices
        end_file = end_file.charCodeAt(0) - 'a'.charCodeAt(0);
        end_rank--;

        let [file, rank] = [piece.file, piece.rank];


        let possible_moves = [];
        let d = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

        // double if at initial position
        d.forEach((square) => {
            if (!this.is_valid_square(file + square[0], rank + square[1])) {
                return;
            }
            if (piece.flip === 1 && this.piece_at(file + square[0], rank + square[1]) <= 0 && !this.check_piece_at(file + square[0], rank + square[1], piece.flip)) {
                possible_moves.push([file + square[0], rank + square[1]]);
            }
            else if (piece.flip === -1 && this.piece_at(file + square[0], rank + square[1]) >= 0 && !this.check_piece_at(file + square[0], rank + square[1], piece.flip)) {
                possible_moves.push([file + square[0], rank + square[1]]);
            }
        })

        let possible = false;
        possible_moves.forEach((move) => {
            if (move[0] === end_file && move[1] === end_rank) {
                possible = true;
            }
        });

        return possible;
    }

    // return piece at board square
    // assumes the piece location is valid
    // uses numbers
    get_piece(file, rank) {
        let p;
        this.white_pieces.forEach((piece) => {
            if (piece.state.mode === EATEN) {
                return;
            }
            if (piece.file === file && piece.rank === rank) {
                p = piece;
            }
        });

        this.black_pieces.forEach((piece) => {
            if (piece.state.mode === EATEN) {
                return;
            }
            if (piece.file === file && piece.rank === rank) {
                p = piece;
            }
        });

        return p;
    }

    // uses letters and nubmers like move("e", 4, "e", 5)
    move(start_file, start_rank, end_file, end_rank, t) {
        let [file, rank] = [start_file.charCodeAt(0) - 'a'.charCodeAt(0), start_rank - 1];
        let [file2, rank2] = [end_file.charCodeAt(0) - 'a'.charCodeAt(0), end_rank - 1];

        if (!this.piece_at(file, rank)) {
            return false; 
        }

        let possible = false;

        switch (Math.abs(this.piece_at(file, rank))) {
            case ROOK:
                possible = this.can_move_rook(this.get_piece(file, rank), end_file, end_rank);
                break;
            case KNIGHT:
                possible = this.can_move_knight(this.get_piece(file, rank), end_file, end_rank);
                break;
            case BISHOP:
                possible = this.can_move_bishop(this.get_piece(file, rank), end_file, end_rank);
                break;
            case QUEEN:
                possible = this.can_move_queen(this.get_piece(file, rank), end_file, end_rank);
                break;
            case KING:
                possible = this.can_move_king(this.get_piece(file, rank), end_file, end_rank);
                break;
            case PAWN:
                possible = this.can_move_pawn(this.get_piece(file, rank), end_file, end_rank);
                break;
        }


        if (!possible) {
            return false;
        }

        let p = this.get_piece(file, rank);
        console.log(p);
        // tell piece to start moving

        p.move_to(file2, rank2, t);
        this.board[file][rank] = 0;

        return true;
    }

    update_board() {
        // update white pieces
        this.white_pieces.forEach((piece) => {

            if (piece.state.mode === EATEN) {
                this.board[piece.file][piece.rank] = 0;
            }
        });

        this.black_pieces.forEach((piece) => {

            if (piece.state.mode === EATEN) {
                this.board[piece.file][piece.rank] = 0;
            }
        });

        this.white_pieces.forEach((piece) => {
            if (piece.state.mode === IDLE) {
                this.board[piece.file][piece.rank] = piece.piece * piece.flip;
            }

        });

        this.black_pieces.forEach((piece) => {
            if (piece.state.mode === IDLE) {
                this.board[piece.file][piece.rank] = piece.piece * piece.flip;
            }

        });
    }

    display(context, program_state) {
        // display():  Called once per frame of animation.
        const t = program_state.animation_time / 1000, dt = program_state.animation_delta_time / 1000;

        // update board state
        this.update_board();

        for (const move of this.moveQueue) {
            if (move.from_ !== "" && move.to !== "") {
                const start_file = move.from_.substring(5, 6);
                const start_rank = move.from_.charCodeAt(6) - '0'.charCodeAt(0);
                const end_file = move.to.substring(5, 6);
                const end_rank = move.to.charCodeAt(6) - '0'.charCodeAt(0);

                if (this.move(start_file, start_rank, end_file, end_rank, t)) {
                    console.log({ move }, 'successful');
                }
                else {
                    console.log({ move }, 'failed');
                }
            }
        }
        // clear move queue
        this.moveQueue.splice(0, this.moveQueue.length);

        // Setup -- This part sets up the scene's overall camera matrix, projection matrix, and lights:
        if (!context.scratchpad.controls) {
            this.children.push(context.scratchpad.controls = new defs.Movement_Controls());
            // Define the global camera and projection matrices, which are stored in program_state.
            program_state.set_camera(this.initial_camera_location);
        }
        if(this.player === 0){
            let desired = Mat4.inverse(Mat4.identity().times(Mat4.rotation(0.6,1,0,0)).times(Mat4.rotation(Math.PI,0,1,0)).times(Mat4.translation(9,5.22,18)));
            program_state.set_camera(desired);
            this.player=2; 
        }
        else if(this.player === 1){
            let desired = Mat4.inverse(Mat4.identity().times(Mat4.rotation(-0.6,1,0,0)).times(Mat4.translation(-8,-4.2,32)));
            program_state.set_camera(desired);
            this.player=2; 
        }


        program_state.projection_transform = Mat4.perspective(
            Math.PI / 4, context.width / context.height, .1, 1000);


        // DONE: Lighting (Requirement 2)
        const light_position = vec4(0, 5, 5, 1);
        // The parameters of the Light are: position, color, size
        program_state.lights = [
            new Light(light_position, color(1, 1, 1, 1), 1000),
            new Light(vec4(0, 20, 0, 1), color(1, 1, 1, 1), 10000)
        ];

        this.picker.update(context, program_state);

        let model_transform = Mat4.identity();


        let selected_file = -1, selected_rank = -1;
        if (this.selected_square !== "") {
            selected_file = this.selected_square.charCodeAt(5) - 'a'.charCodeAt(0);
            selected_rank = this.selected_square.charCodeAt(6) - '0'.charCodeAt(0) - 1;
        }
        
        this.white_pieces.forEach((piece, i) => {
            // console.log(piece.model_transform);
            if (piece.state.mode === EATEN) {
                return;
            }

            if (selected_file === piece.file && selected_rank === piece.rank) {
                piece.shape.draw(context, program_state, piece.compute_transform(t).times(Mat4.rotation(t, 0, 1, 0)),
                    this.materials.piece.override({ cooldown: piece.getCooldown() }));
            }
            else {
                piece.shape.draw(context, program_state, piece.compute_transform(t),
                    this.materials.piece.override({ cooldown: piece.getCooldown() }));
            }
        });

        this.black_pieces.forEach((piece, i) => {
            if (piece.state.mode === EATEN) {
                return;
            }

            if (selected_file === piece.file && selected_rank === piece.rank) {
                piece.shape.draw(context, program_state, piece.compute_transform(t).times(Mat4.rotation(t, 0, 1, 0)),
                    this.materials.piece.override({ color: hex_color("#000000"), cooldown: piece.getCooldown() }));
            }
            else {
                piece.shape.draw(context, program_state, piece.compute_transform(t),
                    this.materials.piece.override({ color: hex_color("#000000"), cooldown: piece.getCooldown() }));
            }
        });

        this.white_pieces.forEach((piece, i) => {
            if (!piece.alive) {
                return;
            }
            
            const piece_matrix = piece.compute_transform(t);
            const piece_x = piece_matrix[0][3];
            const piece_y = piece_matrix[1][3];
            const piece_z = piece_matrix[2][3];
            this.black_pieces.forEach((enemy, j)=>{
                if(piece.state.mode !== MOVING && enemy.state.mode !== MOVING){
                    return;
                }
                if(!enemy.alive){
                    return;
                }
                const enemy_matrix = enemy.compute_transform(t);
                const enemy_x = enemy_matrix[0][3];
                const enemy_y = enemy_matrix[1][3];
                const enemy_z = enemy_matrix[2][3];
                
                const kill = (piece) =>{
                    piece.kill();
                    if(Math.abs(piece.piece) === KING){
                        alert(piece.flip < 0 ? 'White won' : 'Black won');
                        this.reset_board();
                    }


                };

                if(Math.sqrt((piece_x-enemy_x)**2+(piece_z-enemy_z)**2) < PIECE_RADIUS){
                    if(piece.state.mode === MOVING && enemy.state.mode !== MOVING){
                        kill(enemy);
                    }
                    else if(piece.state.mode !== MOVING && enemy.state.mode === MOVING){
                        kill(piece);
                    }
                    else{
                        if(piece_y>enemy_y){
                            kill(enemy);
                        }
                        else{ 
                            kill(piece);
                        }
                    }
                }
            })
        });

        // draw the chess board
        for (let i = 0; i < 8; i++) {
            for (let j = 1; j < 9; j++) {

                // model_transform = model_transform.times(Mat4.translation(5, 0, 0));
                this.shapes.grid.draw(context, program_state, model_transform.times(Mat4.translation(2.4 * j - 19.2, -1.5, 2.4 * i)).times(Mat4.scale(1.2, 0.1, 1.2)),
                    this.materials.grid.override({ color: (i + j) % 2 == 0 ? hex_color("#000000") : hex_color("#ffffff") }));
            }
        }
        this.shapes.walls.draw(context, program_state, model_transform.times(Mat4.translation(1, 500, 1)).times(Mat4.scale(500, 1, 500)), this.materials.top);
        this.shapes.walls.draw(context, program_state, model_transform.times(Mat4.translation(1, -500, 1)).times(Mat4.scale(500, 1, 500)), this.materials.bottom);
        this.shapes.walls.draw(context, program_state, model_transform.times(Mat4.translation(-500, 1, 1)).times(Mat4.scale(1, 500, 500)), this.materials.left);
        this.shapes.walls.draw(context, program_state, model_transform.times(Mat4.translation(500, 1, 1)).times(Mat4.scale(1, 500, 500)), this.materials.right);
        this.shapes.walls.draw(context, program_state, model_transform.times(Mat4.translation(1, 1, 500)).times(Mat4.scale(500, 500, 1)), this.materials.front);
        this.shapes.walls.draw(context, program_state, model_transform.times(Mat4.translation(1, 1, -500)).times(Mat4.scale(500, 500, 1)), this.materials.back);
        
        this.white_pieces.forEach((piece) => piece.updateCooldown(dt));
        this.black_pieces.forEach((piece) => piece.updateCooldown(dt));
    }
}

class Gouraud_Shader extends Shader {
    // This is a Shader using Phong_Shader as template
    // DONE: Modify the glsl coder here to create a Gouraud Shader (Planet 2)

    constructor(num_lights = 2) {
        super();
        this.num_lights = num_lights;
    }

    shared_glsl_code() {
        // ********* SHARED CODE, INCLUDED IN BOTH SHADERS *********
        return ` 
        precision mediump float;
        const int N_LIGHTS = ` + this.num_lights + `;
        uniform float ambient, diffusivity, specularity, smoothness;
        uniform vec4 light_positions_or_vectors[N_LIGHTS], light_colors[N_LIGHTS];
        uniform float light_attenuation_factors[N_LIGHTS];
        uniform vec4 shape_color;
        uniform vec3 squared_scale, camera_center;

        // Specifier "varying" means a variable's final value will be passed from the vertex shader
        // on to the next phase (fragment shader), then interpolated per-fragment, weighted by the
        // pixel fragment's proximity to each of the 3 vertices (barycentric interpolation).
        varying vec3 N, vertex_worldspace;
        varying vec4 frag_color;
        // ***** PHONG SHADING HAPPENS HERE: *****                                       
        vec3 phong_model_lights( vec3 N, vec3 vertex_worldspace ){                                        
            // phong_model_lights():  Add up the lights' contributions.
            vec3 E = normalize( camera_center - vertex_worldspace );
            vec3 result = vec3( 0.0 );
            for(int i = 0; i < N_LIGHTS; i++){
                // Lights store homogeneous coords - either a position or vector.  If w is 0, the 
                // light will appear directional (uniform direction from all points), and we 
                // simply obtain a vector towards the light by directly using the stored value.
                // Otherwise if w is 1 it will appear as a point light -- compute the vector to 
                // the point light's location from the current surface point.  In either case, 
                // fade (attenuate) the light as the vector needed to reach it gets longer.  
                vec3 surface_to_light_vector = light_positions_or_vectors[i].xyz - 
                                               light_positions_or_vectors[i].w * vertex_worldspace;                                             
                float distance_to_light = length( surface_to_light_vector );

                vec3 L = normalize( surface_to_light_vector );
                vec3 H = normalize( L + E );
                // Compute the diffuse and specular components from the Phong
                // Reflection Model, using Blinn's "halfway vector" method:
                float diffuse  =      max( dot( N, L ), 0.0 );
                float specular = pow( max( dot( N, H ), 0.0 ), smoothness );
                float attenuation = 1.0 / (1.0 + light_attenuation_factors[i] * distance_to_light * distance_to_light );
                
                vec3 light_contribution = shape_color.xyz * light_colors[i].xyz * diffusivity * diffuse
                                                          + light_colors[i].xyz * specularity * specular;
                result += attenuation * light_contribution;
            }
            return result;
        } `;
    }

    vertex_glsl_code() {
        // ********* VERTEX SHADER *********
        return this.shared_glsl_code() + `
            attribute vec3 position, normal;                            
            // Position is expressed in object coordinates.
            
            uniform mat4 model_transform;
            uniform mat4 projection_camera_model_transform;
    
            void main(){                                                                   
                // The vertex's final resting place (in NDCS):
                gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
                // The final normal vector in screen space.
                N = normalize( mat3( model_transform ) * normal / squared_scale);
                vertex_worldspace = ( model_transform * vec4( position, 1.0 ) ).xyz;

                frag_color = vec4( shape_color.xyz * ambient, shape_color.w );
                frag_color.xyz += phong_model_lights( normalize( N ), vertex_worldspace );
            } `;
    }

    fragment_glsl_code() {
        // ********* FRAGMENT SHADER *********
        // A fragment is a pixel that's overlapped by the current triangle.
        // Fragments affect the final image or get discarded due to depth.
        return this.shared_glsl_code() + `
            void main(){                                                           
                gl_FragColor = frag_color;
            } `;
    }

    send_material(gl, gpu, material) {
        // send_material(): Send the desired shape-wide material qualities to the
        // graphics card, where they will tweak the Phong lighting formula.
        gl.uniform4fv(gpu.shape_color, material.color);
        gl.uniform1f(gpu.ambient, material.ambient);
        gl.uniform1f(gpu.diffusivity, material.diffusivity);
        gl.uniform1f(gpu.specularity, material.specularity);
        gl.uniform1f(gpu.smoothness, material.smoothness);
    }

    send_gpu_state(gl, gpu, gpu_state, model_transform) {
        // send_gpu_state():  Send the state of our whole drawing context to the GPU.
        const O = vec4(0, 0, 0, 1), camera_center = gpu_state.camera_transform.times(O).to3();
        gl.uniform3fv(gpu.camera_center, camera_center);
        // Use the squared scale trick from "Eric's blog" instead of inverse transpose matrix:
        const squared_scale = model_transform.reduce(
            (acc, r) => {
                return acc.plus(vec4(...r).times_pairwise(r))
            }, vec4(0, 0, 0, 0)).to3();
        gl.uniform3fv(gpu.squared_scale, squared_scale);
        // Send the current matrices to the shader.  Go ahead and pre-compute
        // the products we'll need of the three special matrices and just
        // cache and send those.  They will be the same throughout this draw
        // call, and thus across each instance of the vertex shader.
        // Transpose them since the GPU expects matrices as column-major arrays.
        const PCM = gpu_state.projection_transform.times(gpu_state.camera_inverse).times(model_transform);
        gl.uniformMatrix4fv(gpu.model_transform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
        gl.uniformMatrix4fv(gpu.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));

        // Omitting lights will show only the material color, scaled by the ambient term:
        if (!gpu_state.lights.length)
            return;

        const light_positions_flattened = [], light_colors_flattened = [];
        for (let i = 0; i < 4 * gpu_state.lights.length; i++) {
            light_positions_flattened.push(gpu_state.lights[Math.floor(i / 4)].position[i % 4]);
            light_colors_flattened.push(gpu_state.lights[Math.floor(i / 4)].color[i % 4]);
        }
        gl.uniform4fv(gpu.light_positions_or_vectors, light_positions_flattened);
        gl.uniform4fv(gpu.light_colors, light_colors_flattened);
        gl.uniform1fv(gpu.light_attenuation_factors, gpu_state.lights.map(l => l.attenuation));
    }

    update_GPU(context, gpu_addresses, gpu_state, model_transform, material) {
        // update_GPU(): Define how to synchronize our JavaScript's variables to the GPU's.  This is where the shader
        // recieves ALL of its inputs.  Every value the GPU wants is divided into two categories:  Values that belong
        // to individual objects being drawn (which we call "Material") and values belonging to the whole scene or
        // program (which we call the "Program_State").  Send both a material and a program state to the shaders
        // within this function, one data field at a time, to fully initialize the shader for a draw.

        // Fill in any missing fields in the Material object with custom defaults for this shader:
        const defaults = {color: color(0, 0, 0, 1), ambient: 0, diffusivity: 1, specularity: 1, smoothness: 40};
        material = Object.assign({}, defaults, material);

        this.send_material(context, gpu_addresses, material);
        this.send_gpu_state(context, gpu_addresses, gpu_state, model_transform);
    }
}

class Ring_Shader extends Shader {
    update_GPU(context, gpu_addresses, graphics_state, model_transform, material) {
        // update_GPU():  Defining how to synchronize our JavaScript's variables to the GPU's:
        const [P, C, M] = [graphics_state.projection_transform, graphics_state.camera_inverse, model_transform],
            PCM = P.times(C).times(M);
        context.uniformMatrix4fv(gpu_addresses.model_transform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
        context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false,
            Matrix.flatten_2D_to_1D(PCM.transposed()));

        context.uniform4fv(gpu_addresses.shape_color, material.color);
    }

    shared_glsl_code() {
        // ********* SHARED CODE, INCLUDED IN BOTH SHADERS *********
        return `
        precision mediump float;
        varying vec4 point_position;
        varying vec4 center;
        uniform vec4 shape_color;
        `;
    }

    vertex_glsl_code() {
        // ********* VERTEX SHADER *********
        // DONE:  Complete the main function of the vertex shader (Extra Credit Part II).
        return this.shared_glsl_code() + `
        attribute vec3 position;
        uniform mat4 model_transform;
        uniform mat4 projection_camera_model_transform;
        
        void main(){
            gl_Position = projection_camera_model_transform * vec4(position, 1.0);
            point_position = vec4(position, 1.);
            center = vec4(0, 0, 0, 1);
        }`;
    }

    fragment_glsl_code() {
        // ********* FRAGMENT SHADER *********
        // DONE:  Complete the main function of the fragment shader (Extra Credit Part II).
        return this.shared_glsl_code() + `
        void main(){
            // below k results in 7 rings just like in demo
            float k = 60.;
            // alpha automatically clamped to 0,1
            // multiplying by 2 results in clearer boundary
            float alpha = 2. * sin(k * distance(point_position, center));

            gl_FragColor = vec4(shape_color.xyz, alpha);
        }`;
    }
}

