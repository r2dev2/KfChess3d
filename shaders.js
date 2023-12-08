import { defs, tiny } from './examples/common.js';

// accepts cooldown between 0. and 1.
export class Cooldown_Shader extends defs.Textured_Phong {
    fragment_glsl_code() {
      // ********* FRAGMENT SHADER *********
      // A fragment is a pixel that's overlapped by the current triangle.
      // Fragments affect the final image or get discarded due to depth.
      return this.shared_glsl_code() + `
          varying vec2 f_tex_coord;
          uniform sampler2D texture;
          uniform float cooldown_level;
    
          void main(){
              // Sample the texture image in the correct place:
              vec4 tex_color = texture2D( texture, f_tex_coord );
              if (tex_color.w < .01) discard;

              vec3 mixin = vec3(1., 0.2, 0.2);
              if (vertex_worldspace.y > cooldown_level) {
                mixin = vec3(1., 1., 1.);
              }
                                                                       // Compute an initial (ambient) color:
            
              gl_FragColor = vec4( ( tex_color.xyz + shape_color.xyz ) * mixin * ambient, shape_color.w * tex_color.w );
                                                                       // Compute the final color with contributions from lights:
              gl_FragColor.xyz += phong_model_lights( normalize( N ), vertex_worldspace );
            } `;
    }

    update_GPU(context, gpu_addresses, gpu_state, model_transform, material) {
        super.update_GPU(context, gpu_addresses, gpu_state, model_transform, material);
        // scale [0, 1] to [-1.4, 2.]
        const min = -1.4;
        const max = 2.;
        const level = material.cooldown * (max - min) + min;
        context.uniform1f(gpu_addresses.cooldown_level, level);
    }
};
