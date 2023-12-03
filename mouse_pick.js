import {defs, tiny} from './examples/common.js';

const { color } = tiny;

export class MousePicker {
    // find out which object is clicked
    // usage:
    // >>> const picker = new MousePicker(scene);
    // >>> picker.onClicked(object => console.log('object id', object, 'clicked'));
    // >>> picker.update(context, program_state); // call in beginning of display()

    // scene is the Scene object (like Chess)
    // for MousePicker support, we require a .tracked attribute
    // which is an array of shapes which have .drawOverride() which draws with
    // texture override
    #scene;

    // cssX and cssY are the mouse location in css coordinate space
    #cssX;
    #cssY;

    // canvas element for renders
    #canvas;

    // object mouse is hovered on, will be null if no object
    // and number id if there is an object
    #object;

    // people listening for mouse clicks
    #listeners;

    constructor(scene) {
        this.#scene = scene;
        this.#cssX = -1;
        this.#cssY = -1;
        this.#object = null;
        this.#listeners = [];

        setTimeout(() => {
            this.#canvas = document.querySelector('canvas');
            this.#canvas.addEventListener('mousemove', e => {
                const rect = this.#canvas.getBoundingClientRect();
                this.#cssX = e.clientX - rect.left;
                this.#cssY = e.clientY - rect.top;
            });

            this.#canvas.addEventListener('click', e => {
                // use a .forEach in case the listener throws exception
                this.#listeners.forEach(listener => {
                    listener(this.#object);
                });
            })
        }, 100);
    }

    onClicked(cb) {
        this.#listeners.push(cb);
    }

    update(context, program_state) {
        // draw each tracked object with red of the object id
        const gl = context.context;

        for (const object of this.#scene.tracked) {
            object.drawOverride(context, program_state, { color: color(object.id / 255.0, 0., 0., 1.) });
        };

        // read the pixel value at the position of mouse, id will be red component of rgba
        const pixelX = this.#cssX * gl.canvas.width / gl.canvas.clientWidth;
        const pixelY = gl.canvas.height - this.#cssY * gl.canvas.height / gl.canvas.clientHeight - 1;
        const data = new Uint8Array(4);
        gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);

        this.#object = data[0] == 0 ? null : data[0];
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
}
