// RIMRIFT Harbor Point sunset sky: the themes.js three-colour gradient (top / horizon / ground), a warm band that
// widens toward the sun, the sun disc and its glow. The disc and glow are dimmed in the cubemap (radiance) pass so
// the ambient light is the theme's dim cool sky, not the sun's corona.
shader_type sky;
render_mode use_debanding;

uniform vec3 top_color : source_color = vec3(0.18, 0.23, 0.48);
uniform vec3 horizon_color : source_color = vec3(1.0, 0.56, 0.32);
uniform vec3 ground_color : source_color = vec3(0.35, 0.25, 0.2);
uniform vec3 ground_horizon : source_color = vec3(0.62, 0.42, 0.34);
uniform vec3 sun_dir = vec3(-0.24, 0.14, 0.96);
uniform vec3 sun_color : source_color = vec3(1.0, 0.78, 0.5);
uniform float sun_size_deg = 1.6;      // apparent diameter (the real sun is 0.53°; bigger reads as the poster)
uniform float sun_energy = 12.0;       // HDR value of the disc (AgX rolls it off)
uniform float glow_energy = 1.6;       // the corona
uniform float band_energy = 1.2;       // the warm band along the horizon toward the sun
uniform float sky_curve = 0.22;        // how fast the horizon colour gives way to the top colour
uniform float radiance_sun = 0.08;     // sun disc + glow scale in the cubemap pass (ambient / reflections)

void sky() {
	vec3 d = EYEDIR;
	vec3 s = normalize(sun_dir);
	float up = clamp(d.y, 0.0, 1.0);
	float cosang = dot(d, s);
	// gradient
	vec3 col;
	if (d.y >= 0.0) {
		col = mix(horizon_color, top_color, pow(up, sky_curve));
	} else {
		col = mix(ground_horizon, ground_color, clamp(-d.y * 6.0, 0.0, 1.0));
	}
	// the warm band: strongest on the horizon under the sun, fading up and away from it
	float toward = pow(max(cosang, 0.0), 2.0);
	float low = exp(-max(d.y, 0.0) * 7.0);
	col += horizon_color * band_energy * toward * low * (d.y >= 0.0 ? 1.0 : 0.4);
	// corona + disc
	float k = AT_CUBEMAP_PASS ? radiance_sun : 1.0;
	float glow = pow(max(cosang, 0.0), 40.0) * 0.25 + pow(max(cosang, 0.0), 160.0) * 0.6 + pow(max(cosang, 0.0), 700.0) * 1.2;
	col += sun_color * glow * glow_energy * k;
	float r = radians(sun_size_deg * 0.5);
	float disc = smoothstep(cos(r * 1.25), cos(r), cosang);
	col += sun_color * disc * sun_energy * k * (d.y >= -0.002 ? 1.0 : 0.0);
	COLOR = col;
}
