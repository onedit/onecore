///@INFO: PARSER
// https://www.khronos.org/files/gltf20-reference-guide.pdf
GLTFParser = {

	BYTE: 5120,
	UNSIGNED_BYTE: 5121,
	SHORT: 5122,
	UNSIGNED_SHORT: 5123,
	UNSIGNED_INT: 5125,
	FLOAT: 5126,

	JSON_CHUNK: 0x4E4F534A,
	BINARY_CHUNK: 0x004E4942,

	numComponents: { "SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16 },

	rename_animation_properties: { "translation":"position","scale":"scaling" },

	flip_uv: true,

	prefabs: {},

	texture_options: { format: GL.RGBA, magFilter: GL.LINEAR, minFilter: GL.LINAR_MIPMAP_LINEAR, wrap: GL.REPEAT },

	parseGLB: function(data)
	{
		var view = new Uint8Array( data );

		//read header
		var endianess = true;
		var dv = new DataView( data );
		var magic = dv.getUint32(0,endianess);

		if(magic != 0x46546C67)
		{
			console.error("incorrect gltf header");
			return null;
		}
		var version = dv.getUint32(4,endianess);
		console.log("GLTF Version: " + version);

		var length = dv.getUint32(8,endianess); //full size

		var byteOffset = 12;
		var json = null;
		var chunk_index = 0;

		//first chunk
		while(byteOffset < view.length)
		{
			var chunk_size = dv.getUint32(byteOffset,endianess);
			var chunk_type = dv.getUint32(byteOffset+4,endianess);
			var chunk_data = data.slice(byteOffset+8, byteOffset+8+chunk_size);
			byteOffset += 8 + chunk_size;

			if(chunk_type == GLTFParser.JSON_CHUNK)
			{
				if (!("TextDecoder" in window))
				  throw("Sorry, this browser does not support TextDecoder...");

				var enc = new TextDecoder("utf-8");
				var str = enc.decode(chunk_data);
				json = JSON.parse(str);
			}
			else if(chunk_type == GLTFParser.BINARY_CHUNK)
			{
				var buffer = json.buffers[chunk_index];
				buffer.data = chunk_data;
				buffer.dataview = new Uint8Array(chunk_data);
				if(data.byteLength != buffer.byteLength)
					console.warn("gltf binary doesnt match json size hint");
				chunk_index++;
			}
			else
				console.warn("gltf unknown chunk type: ", "0x"+chunk_type.toString(16));
		}

		return json;
	},

	parseGLTF: function(json)
	{
		console.log(json);

		var root = null;
		var nodes_by_id = {};
		if( json.scenes.length > 1 )
			console.warn("gltf importer only supports one scene per file, skipping the rest");

		var nodes_info = json.scenes[ json.scene ].nodes;

		var root = null;
		if(nodes_info.length > 1) //multiple root nodes
		{
			root = new LS.SceneNode();
			root.name = "root";
		}

		for(var i = 0; i < nodes_info.length; ++i)
		{
			var info = nodes_info[i];
			if(info.node)
				continue;
			var node = GLTFParser.parseNode( null, i, json );
			if(!root)
				root = node;
			if(nodes_info.length > 1)
				root.addChild( node );
			node.id = json.url.replace(/\//gi,"_") + "::node_" + i;
			nodes_by_id[ node.id ] = nodes_by_id[ i ] = node;
		}

		if(json.animations && json.animations.length)
		{
			if(!LS.Animation)
				console.error("you must include rendeer-animation.js to allow animations");
			else
			{
				root.animations = [];
				for(var i = 0; i < json.animations.length; ++i)
				{
					var animation = this.parseAnimation(i,json,nodes_by_id);
					if(animation)
					{
						RD.Animations[ animation.name ] = animation;
						root.animations.push(animation);
					}
				}
			}
		}

		return root;
	},

	parseNode: function(node, index, json)
	{
		var info = json.nodes[ index ];

		node = node || new LS.SceneNode();

		//extract node info
		for(var i in info)
		{
			var v = info[i];
			switch(i)
			{
				case "name": node.name = v; break;
				case "translation": node.position = v; break;
				case "rotation": node.rotation = v; break;
				case "scale": node.scaling = v; break;
				case "matrix": 
					node.fromMatrix( v );
					break;
				case "mesh": 
					var mesh = GLTFParser.parseMesh(v, json);
					if(mesh)
					{
						node.mesh = mesh.name;
						node.primitives = [];
						for(var j = 0; j < mesh.info.groups.length; ++j)
						{
							var group = mesh.info.groups[j];
							var material = this.parseMaterial( group.material, json );
							node.primitives.push({
								index: j, 
								material: material.name,
								mode: group.mode
							});
						}
					}
					break;
				case "skin":
					node.skin = this.parseSkin( v, json );
					break;
				case "children": 
					if(v.length)
					{
						for(var j = 0; j < v.length; ++j)
						{
							var subnode_info = json.nodes[ v[j] ];
							var subnode = GLTFParser.parseNode( null, v[j], json );
							node.addChild(subnode);
						}
					}
					break;
				default:
					console.log("feature skipped",j);
					break;
			}
		}

		if(!info.name)
			info.name = node.name = "node_" + index;

		return node;
	},

	parseMesh: function(index, json)
	{
		var mesh_info = json.meshes[index];
		var meshes_container = gl.meshes;

		//extract primitives
		var meshes = [];
		var prims = [];
		for(var i = 0; i < mesh_info.primitives.length; ++i)
		{
			var prim = this.parsePrimitive( mesh_info, i, json );
			prims.push(prim);
			var mesh_primitive = { vertexBuffers: {}, indexBuffers:{} };
			for(var j in prim.buffers)
				if( j == "indices" || j == "triangles" )
					mesh_primitive.indexBuffers[j] = { data: prim.buffers[j] };
				else
					mesh_primitive.vertexBuffers[j] = { data: prim.buffers[j] };
			meshes.push({ mesh: mesh_primitive });
		}

		//merge primitives
		var mesh = null;
		if(meshes.length > 1)
			mesh = GL.Mesh.mergeMeshes( meshes );
		else
		{
			var mesh_data = meshes[0].mesh;
			mesh = new GL.Mesh( mesh_data.vertexBuffers, mesh_data.indexBuffers );
			if( mesh.info && mesh_data.info)
				mesh.info = mesh_data.info;
		}

		for(var i = 0; i < mesh_info.primitives.length; ++i)
		{
			var g = mesh.info.groups[i];
			if(!g)
				mesh.info.groups[i] = g = {};
			var prim = mesh_info.primitives[i];
			g.material = prim.material;
			g.mode = prim.mode;
			g.start = prims[i].start;
			g.length = prims[i].length;
		}

		mesh.name = mesh_info.name || "mesh_" + index;
		//mesh.material = primitive.material;
		//mesh.primitive = mesh_info.mode;
		meshes_container[ mesh.name ] = mesh;
		return mesh;
	},

	parsePrimitive: function( mesh_info, index, json )
	{
		var primitive = {
			buffers: {}
		};
		var buffers = primitive.buffers;

		var primitive_info = mesh_info.primitives[ index ];
		if(primitive_info.extensions)
		{
			throw("mesh data is compressed, this importer does not support it yet");
			return null;
		}

		if(!primitive_info.attributes.POSITION == null)
			console.warn("gltf mesh without positions");
		else
			buffers.vertices = this.parseAccessor( primitive_info.attributes.POSITION, json );
		if(primitive_info.attributes.NORMAL != null)
			buffers.normals = this.parseAccessor( primitive_info.attributes.NORMAL, json );
		if(primitive_info.attributes.TEXCOORD_0 != null)
			buffers.coords = this.parseAccessor( primitive_info.attributes.TEXCOORD_0, json, this.flip_uv );
		if(primitive_info.attributes.TEXCOORD_1 != null)
			buffers.coords1 = this.parseAccessor( primitive_info.attributes.TEXCOORD_1, json, this.flip_uv );
		//skinning
		if(primitive_info.attributes.WEIGHTS_0 != null)
			buffers.weights = this.parseAccessor( primitive_info.attributes.WEIGHTS_0, json );
		if(primitive_info.attributes.JOINTS_0 != null)
			buffers.bones = this.parseAccessor( primitive_info.attributes.JOINTS_0, json );

		//indices
		if(primitive_info.indices != null)
			buffers.triangles = this.parseAccessor( primitive_info.indices, json );

		primitive.mode = primitive_info.mode;
		primitive.material = primitive_info.material;
		primitive.start = 0;
		primitive.length = buffers.triangles ? buffers.triangles.length : buffers.vertices.length / 3;
		return primitive;
	},

	parseAccessor: function(index, json, flip_y)
	{
		var accessor = json.accessors[index];
		if(!accessor)
		{
			console.warn("gltf accessor not found");
			return null;
		}

		var components = this.numComponents[ accessor.type ];
		if(!components)
		{
			console.warn("gltf accessor of unknown type:",accessor.type);
			return null;
		}

		//num numbers
		var size = accessor.count * components;

		//create buffer
		switch( accessor.componentType )
		{
			case GLTFParser.FLOAT: databuffer = new Float32Array( size ); break;
			case GLTFParser.UNSIGNED_INT: databuffer = new Uint32Array( size ); break;
			case GLTFParser.SHORT: databuffer = new Int16Array( size );  break;
			case GLTFParser.UNSIGNED_SHORT: databuffer = new Uint16Array( size );  break;
			case GLTFParser.BYTE: databuffer = new Int8Array( size );  break;
			case GLTFParser.UNSIGNED_BYTE: databuffer = new Uint8Array( size );  break;
			default:
				console.warn("gltf accessor of unsupported type: ", accessor.componentType);
				databuffer = new Float32Array( size );
		}

		var bufferView = json.bufferViews[ accessor.bufferView ];
		if(!bufferView)
		{
			console.warn("gltf bufferView not found");
			return null;
		}

		var buffer = json.buffers[ bufferView.buffer ];
		if(!buffer || !buffer.data)
		{
			console.warn("gltf buffer not found or data not loaded");
			return null;
		}

		if(bufferView.byteStride && bufferView.byteStride != components * databuffer.BYTES_PER_ELEMENT)
		{
			console.warn("gltf buffer data is not tightly packed, not supported");
			return null;
		}

		var databufferview = new Uint8Array( databuffer.buffer );

		if(bufferView.byteOffset == null)//could happend when is 0
			bufferView.byteOffset = 0;

		//extract chunk from binary (not using the size from the bufferView because sometimes it doesnt match!)
		var start = bufferView.byteOffset + (accessor.byteOffset || 0);
		var chunk = buffer.dataview.subarray( start, start + databufferview.length );

		//copy data to buffer
		databufferview.set( chunk );

		if(flip_y)
			for(var i = 1; i < databuffer.length; i += components )
				databuffer[i] = 1.0 - databuffer[i]; 

		return databuffer;
	},

	parseMaterial: function( index, json )
	{
		var info = json.materials[index];
		if(!info)
		{
			console.warn("gltf material not found");
			return null;
		}

		var material = RD.Materials[ info.name ];
		if(material)
			return material;

		material = new RD.Material();
		material.name = info.name;
		//material.shader_name = "phong";

		if(info.alphaMode != null)
			material.blendMode = info.alphaMode;
		material.alphaCutoff = info.alphaCutoff != null ? info.alphaCutoff : 0.5;
		if(info.doubleSided != null)
			material.flags.two_sided = info.doubleSided;

		if(info.pbrMetallicRoughness)
		{
			material.model = "pbrMetallicRoughness";

			//default values
			material.color.set([1,1,1]);
			material.opacity = 1;
			material.metallicFactor = 1;
			material.roughnessFactor = 1;

			if(info.pbrMetallicRoughness.baseColorFactor != null)
				material.color = info.pbrMetallicRoughness.baseColorFactor;
			if(info.pbrMetallicRoughness.baseColorTexture)
				material.textures.albedo = this.parseTexture( info.pbrMetallicRoughness.baseColorTexture, json );
			if(info.pbrMetallicRoughness.metallicFactor != null)
				material.metallicFactor = info.pbrMetallicRoughness.metallicFactor;
			if(info.pbrMetallicRoughness.roughnessFactor != null)
				material.roughnessFactor = info.pbrMetallicRoughness.roughnessFactor;
			//GLTF do not support metallic or roughtness in individual textures
			if(info.pbrMetallicRoughness.metallicRoughnessTexture) //RED: Occlusion, GREEN: Roughtness, BLUE: Metalness
				material.textures.metallicRoughness = this.parseTexture( info.pbrMetallicRoughness.metallicRoughnessTexture, json );
		}

		if(info.occlusionTexture)
			material.textures.occlusion = this.parseTexture( info.occlusionTexture, json );
		if(info.normalTexture)
			material.textures.normal = this.parseTexture( info.normalTexture, json );
		if(info.emissiveTexture)
			material.textures.emissive = this.parseTexture( info.emissiveTexture, json );
		if(info.emissiveFactor)
			material.emissive = info.emissiveFactor;

		RD.Materials[ material.name ] = material;
		return material;
	},

	parseTexture: function( mat_tex_info, json )
	{
		var info = json.textures[ mat_tex_info.index ];
		if(!info)
		{
			console.warn("gltf texture not found");
			return null;
		}

		//source
		var source = json.images[ info.source ];
		var extension = "";
		var image_name = null;
		if(source.uri)
		{
			image_name = source.uri;
			extension = image_name.split(".").pop();
		}
		else
		{
			image_name = json.url.replace(/[\/\.\:]/gi,"_") + "_image_" + mat_tex_info.index;// + ".png";
			if( source.mimeType )
				extension = (source.mimeType.split("/").pop());
			else
				extension = "png"; //defaulting
			image_name += "." + extension;
		}
		var tex = gl.textures[ image_name ];
		if( tex )
			return image_name;

		var result = {};

		if(source.uri) //external image file
		{
			var filename = source.uri;
			if(filename.substr(0,5) == "data:")
			{
				var start = source.uri.indexOf(",");
				var mimeType = source.uri.substr(5,start);
				var extension = mimeType.split("/").pop().toLowerCase();
				var image_name = json.folder + "/" + filename + "image_" + mat_tex_info.index + "." + extension;
				var image_bytes = _base64ToArrayBuffer( source.uri.substr(start+1) );
				var image_url = URL.createObjectURL( new Blob([image_bytes],{ type : mimeType }) );
				//var img = new Image(); img.src = image_url; document.body.appendChild(img); //debug
				var texture = GL.Texture.fromURL( image_url, this.texture_options );
				texture.name = image_name;
				gl.textures[ image_name ] = texture;

			}
			else
				result.filename = json.folder + "/" + filename;
		}
		else if(source.bufferView != null) //embeded image file
		{
			var bufferView = json.bufferViews[ source.bufferView ];
			if(bufferView.byteOffset == null)
				bufferView.byteOffset = 0;
			var buffer = json.buffers[ bufferView.buffer ];
			var image_bytes = buffer.data.slice( bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength );
			var image_url = URL.createObjectURL( new Blob([image_bytes],{ type : source.mimeType }) );
			//var img = new Image(); img.src = image_url; document.body.appendChild(img); //debug
			var texture = GL.Texture.fromURL( image_url, this.texture_options );
			texture.name = image_name;
			gl.textures[ image_name ] = texture;
		}

		result.texture = image_name;

		//sampler
		if(info.sampler != null)
		{
			var sampler = json.samplers[ info.sampler ];
			if(sampler.magFilter != null)
				result.magFilter = sampler.magFilter;
			if(sampler.minFilter != null)
				result.minFilter = sampler.minFilter;
		}

		if( mat_tex_info.texCoord )
			result.uv_channel = mat_tex_info.texCoord;

		return result;
	},

	parseSkin: function( index, json )
	{
		var info = json.skins[ index ];
		var skin = {};
		skin.skeleton_root = json.nodes[ info.skeleton ].name;
		skin.bindMatrices = this.splitBuffer( this.parseAccessor( info.inverseBindMatrices, json ), 16 );
		skin.joints = [];
		for(var i = 0; i < info.joints.length; ++i)
		{
			var joint = json.nodes[ info.joints[i] ];
			skin.joints.push( joint.id );
		}
		return skin;
	},

	splitBuffer: function( buffer, length )
	{
		var l = buffer.length;
		var result = [];
		for(var i = 0; i < l; i+= length)
			result.push( new buffer.constructor( buffer.subarray(i,i+length) ) );
		return result;
	},

	parseAnimation: function(index, json, nodes_by_id )
	{
		var info = json.animations[index];
		var animation = new RD.Animation();
		animation.name = info.name || "anim_" + index;
		var duration = 0;

		for(var i = 0; i < info.channels.length; ++i)
		{
			var track = new RD.Animation.Track();
			var channel = info.channels[i];
			var sampler = info.samplers[channel.sampler];

			track.target_node = json.nodes[ channel.target.node ].name;
			track.target_property = channel.target.path.toLowerCase();

			var renamed = this.rename_animation_properties[ track.target_property ];
			if(renamed)
				track.target_property = renamed;

			var timestamps = this.parseAccessor( sampler.input, json );
			var keyframedata = this.parseAccessor( sampler.output, json );
			var type = json.accessors[ sampler.output ].type;
			var type_enum = RD.TYPES[type];
			if( type_enum == RD.VEC4 && track.target_property == "rotation")
				type_enum = RD.QUAT;
			track.type = type_enum;
			var num_components = RD.TYPES_SIZE[ type_enum ];

			if(!num_components)
			{
				console.warn("gltf unknown type:",type);
				continue;
			}
			var num_elements = keyframedata.length / num_components;
			var keyframes = new Float32Array( (1+num_components) * num_elements );
			for(var j = 0; j < num_elements; ++j)
			{
				keyframes[j*(1+num_components)] = timestamps[j];
				var value = keyframedata.subarray(j,j+num_components);
				if(type_enum == RD.QUAT)
					quat.identity(value,value);
				keyframes.set( value, j*(1+num_components)+1 );
			}
			track.data = keyframes;
			track.packed_data = true;
			duration = Math.max( duration, timestamps[ timestamps.length - 1] );

			animation.addTrack( track );
		}

		animation.duration = duration;

		return animation;
	},

	loadFromFiles: function(files,callback)
	{
		//search for .GLTF
		//...
		var files_data = {};
		var pending = files.length;
		var that = this;
		var bins = [];

		for(var i = 0; i < files.length; ++i)
		{
			var file = files[i];
			var reader = new FileReader();
			var t = file.name.split(".");
			var extension = t[ t.length - 1 ].toLowerCase();
			reader.onload = inner;
			reader.filename = file.name;
			reader.extension = extension;
			if(extension == "gltf")
				reader.readAsText(file);
			else
				reader.readAsArrayBuffer(file);
		}

		function inner(e)
		{
			var data = e.target.result;
			var extension = this.extension;
			if(extension == "gltf")
			{
				data = JSON.parse(data);
				files_data["main"] = this.filename;
			}
			else if(extension == "glb")
				files_data["main"] = this.filename;
			else if(extension == "bin")
				bins.push(this.filename);
			else if(extension == "jpeg" || extension == "jpg" || extension == "png")
			{
				var image_url = URL.createObjectURL( new Blob([data],{ type : e.target.mimeType }) );
				var texture = GL.Texture.fromURL( image_url, { wrap: gl.REPEAT, extension: extension } );				
				texture.name = this.filename;
				gl.textures[ texture.name ] = texture;
			}

			files_data[ this.filename ] = { 
				filename: this.filename,
				data: data,
				extension: this.extension
			};
			pending--;
			if(pending == 0)
			{
				files_data["binaries"] = bins;
				that.load( files_data, function(node) {
					if(callback)
						callback(node);
				});
			}
		}
	}
};

function _base64ToArrayBuffer(base64) {
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}



var parserGLTF = {
	extension: "gltf",
	type: "scene",
	resource: "SceneNode",
	format: "text",
	dataType:'text',

	convert_filenames_to_lowercase: true,

	parse: function( data, options, filename )
	{
		if(!data || data.constructor !== String)
		{
			console.error("GLTF is not string");
			return null;
		}

		var clean_filename = LS.RM.getFilename( filename );

		//parser moved to Collada.js library
		var scene = GLTFParser.parseGLTF( data, options, clean_filename );
		console.log( scene ); 

		scene.root.name = clean_filename;

		//apply 90 degrees rotation to match the Y UP AXIS of the system
		if( scene.metadata && scene.metadata.up_axis == "Z_UP" )
			scene.root.model = mat4.rotateX( mat4.create(), mat4.create(), -90 * 0.0174532925 );

		//rename meshes, nodes, etc
		var renamed = {};
		var basename = clean_filename.substr(0, clean_filename.indexOf("."));

		//rename meshes names
		var renamed_meshes = {};
		for(var i in scene.meshes)
		{
			var newmeshname = basename + "__" + i + ".wbin";
			newmeshname = newmeshname.replace(/[^a-z0-9\.\-]/gi,"_"); //newmeshname.replace(/ /#/g,"_");
			renamed[ i ] = newmeshname;
			renamed_meshes[ newmeshname ] = scene.meshes[i];
		}
		scene.meshes = renamed_meshes;

		for(var i in scene.meshes)
		{
			var mesh = scene.meshes[i];
			this.processMesh( mesh, renamed );
		}

		//change local collada ids to valid uids 
		inner_replace_names( scene.root );

		function inner_replace_names( node )
		{
			if(node.id == "root")
			{
				console.warn("DAE contains a node named root, renamed to _root");
				node.id = "_root";
				renamed["root"] = node.id;
			}

			//change uid
			if(node.id && !options.skip_renaming )
			{
				node.uid = "@" + basename + "::" + node.id;
				renamed[ node.id ] = node.uid;
			}
			
			//in case the node has some kind of type
			if(node.type)
			{
				node.node_type = node.type;
				delete node.type; //to be sure it doesnt overlaps with some existing var
			}

			//rename materials
			if(node.material)
			{
				var new_name = node.material.replace(/[^a-z0-9\.\-]/gi,"_") + ".json";
				renamed[ node.material ] = new_name
				node.material = new_name;
			}
			if(node.materials)
				for(var i in node.materials)
				{
					var new_name = node.materials[i].replace(/[^a-z0-9\.\-]/gi,"_") + ".json";
					renamed[ node.material ] = new_name
					node.materials[i] = new_name;
				}

			//change mesh names to engine friendly ids
			if(node.meshes)
			{
				for(var i = 0; i < node.meshes.length; i++)
					if(node.meshes[i] && renamed[ node.meshes[i] ])
						node.meshes[i] = renamed[ node.meshes[i] ];
			}
			if(node.mesh && renamed[ node.mesh ])
				node.mesh = renamed[ node.mesh ];

			if(node.children)
				for(var i in node.children)
					inner_replace_names( node.children[i] );
		}

		//replace skinning joint ids
		for(var i in scene.meshes)
		{
			var mesh = scene.meshes[i];
			if(mesh.bones)
			{
				for(var j in mesh.bones)
				{
					var id = mesh.bones[j][0];
					var uid = renamed[ id ];
					if(uid)
						mesh.bones[j][0] = uid;
				}
			}
		}

		//replace animation name
		if(	scene.root.animation )
			scene.root.animation = this.renameResource( scene.root.animation, scene.root.animation + ".wbin", scene.resources );

		//Materials need some renames
		var renamed_materials = {};
		for(var i in scene.materials)
		{
			var mat = scene.materials[i];
			this.processMaterial( mat );
			renamed_materials[ mat.id ] = mat;
			//this.renameResource( i, mat.id, scene.resources ); //materials are not stored in the resources container
		}
		scene.materials = renamed_materials;

		//check resources
		for(var i in scene.resources)
		{
			var res = scene.resources[i];
			var ext = LS.ResourcesManager.getBasename( i );
			if(!ext)
				console.warn("DAE contains resources without extension: " + i, res.constructor );
			if(res.object_class == "Animation")
				this.processAnimation( res, renamed );
		}

		return scene;
	},

	renameResource: function( old_name, new_name, resources )
	{
		var res = resources[ old_name ];
		if(!res)
		{
			if(!resources[ new_name ])
				console.warn("Resource not found: " + old_name );
			return new_name;
		}
		delete resources[ old_name ];
		resources[ new_name ] = res;
		res.filename = new_name;
		return new_name;
	},

	processMesh: function( mesh, renamed )
	{
		if(!mesh.vertices)
			return; //mesh without vertices?!

		var num_vertices = mesh.vertices.length / 3;
		var num_coords = mesh.coords ? mesh.coords.length / 2 : 0;

		if(num_coords && num_coords != num_vertices )
		{
			var old_coords = mesh.coords;
			var new_coords = new Float32Array( num_vertices * 2 );

			if(num_coords > num_vertices) //check that UVS have 2 components (MAX export 3 components for UVs)
			{
				for(var i = 0; i < num_vertices; ++i )
				{
					new_coords[i*2] = old_coords[i*3];
					new_coords[i*2+1] = old_coords[i*3+1];
				}
			}
			mesh.coords = new_coords;
		}

		//rename morph targets names
		if(mesh.morph_targets)
			for(var j = 0; j < mesh.morph_targets.length; ++j)
			{
				var morph = mesh.morph_targets[j];
				if(morph.mesh && renamed[ morph.mesh ])
					morph.mesh = renamed[ morph.mesh ];
			}
	},

	//depending on the 3D software used, animation tracks could be tricky to handle
	processAnimation: function( animation, renamed )
	{
		for(var i in animation.takes)
		{
			var take = animation.takes[i];

			//apply renaming
			for(var j = 0; j < take.tracks.length; ++j)
			{
				var track = take.tracks[j];
				var pos = track.property.indexOf("/");
				if(!pos)
					continue;
				var nodename = track.property.substr(0,pos);
				var extra = track.property.substr(pos);
				if(extra == "/transform") //blender exports matrices as transform
					extra = "/matrix";

				if( !renamed[nodename] )
					continue;

				nodename = renamed[ nodename ];
				track.property = nodename + extra;
			}

			//rotations could come in different ways, some of them are accumulative, which doesnt work in litescene, so we have to accumulate them previously
			var rotated_nodes = {};
			for(var j = 0; j < take.tracks.length; ++j)
			{
				var track = take.tracks[j];
				track.packed_data = true; //hack: this is how it works my loader
				if(track.name == "rotateX.ANGLE" || track.name == "rotateY.ANGLE" || track.name == "rotateZ.ANGLE")
				{
					var nodename = track.property.split("/")[0];
					if(!rotated_nodes[nodename])
						rotated_nodes[nodename] = { tracks: [] };
					rotated_nodes[nodename].tracks.push( track );
				}
			}

			for(var j in rotated_nodes)
			{
				var info = rotated_nodes[j];
				var newtrack = { data: [], type: "quat", value_size: 4, property: j + "/Transform/rotation", name: "rotation" };
				var times = [];

				//collect timestamps
				for(var k = 0; k < info.tracks.length; ++k)
				{
					var track = info.tracks[k];
					var data = track.data;
					for(var w = 0; w < data.length; w+=2)
						times.push( data[w] );
				}

				//create list of timestamps and remove repeated ones
				times.sort();
				var last_time = -1;
				var final_times = [];
				for(var k = 0; k < times.length; ++k)
				{
					if(times[k] == last_time)
						continue;
					final_times.push( times[k] );
					last_time = times[k];
				}
				times = final_times;

				//create samples
				newtrack.data.length = times.length;
				for(var k = 0; k < newtrack.data.length; ++k)
				{
					var time = times[k];
					var value = quat.create();
					//create keyframe
					newtrack.data[k] = [time, value];

					for(var w = 0; w < info.tracks.length; ++w)
					{
						var track = info.tracks[w];
						var sample = getTrackSample( track, time );
						if(!sample) //nothing to do if no sample or 0
							continue;
						sample *= 0.0174532925; //degrees to radians
						switch( track.name )
						{
							case "rotateX.ANGLE": quat.rotateX( value, value, -sample ); break;
							case "rotateY.ANGLE": quat.rotateY( value, value, sample ); break;
							case "rotateZ.ANGLE": quat.rotateZ( value, value, sample ); break;
						}
					}
				}

				//add track
				take.tracks.push( newtrack );

				//remove old rotation tracks
				for(var w = 0; w < info.tracks.length; ++w)
				{
					var track = info.tracks[w];
					var pos = take.tracks.indexOf( track );
					if(pos == -1)
						continue;
					take.tracks.splice(pos,1);
				}
			}

		}//takes

		function getTrackSample( track, time )
		{
			var data = track.data;
			var l = data.length;
			for(var t = 0; t < l; t+=2)
			{
				if(data[t] == time)
					return data[t+1];
				if(data[t] > time)
					return null;
			}
			return null;
		}
	},

	processMaterial: function(material)
	{
		var rename_channels = {
			specular_factor: "specular",
			transparent: "opacity"
		};

		material.object_class = "StandardMaterial";
		if(material.id)
			material.id = material.id.replace(/[^a-z0-9\.\-]/gi,"_") + ".json";

		if( material.transparency !== undefined )
		{
			material.opacity = 1.0; //fuck it
			//I have no idea how to parse the transparency info from DAEs...
			//https://github.com/openscenegraph/OpenSceneGraph/blob/master/src/osgPlugins/dae/daeRMaterials.cpp#L1185
		}

		//collada supports materials with colors as specular_factor but StandardMaterial only support one value
		if(material.specular_factor && material.specular_factor.length)
			material.specular_factor = material.specular_factor[0];

		if(material.textures)
		{
			var textures = {};
			for(var i in material.textures)
			{
				var tex_info = material.textures[i];
				//channel name must be renamed because there is no consistency between programs
				var channel_name = i;
				if( rename_channels[ channel_name ] )
					channel_name = rename_channels[ channel_name ];
				var filename = tex_info.map_id;
				//convert to lowercase because webglstudio also converts them to lowercase
				if(this.convert_filenames_to_lowercase)
					filename = filename.toLowerCase(); 
				//we allow two sets of texture coordinates
				var coords = LS.Material.COORDS_UV0;
				if( tex_info.uvs == "TEX1")
					coords = LS.Material.COORDS_UV1;
				tex_info = { 
					texture: filename,
					uvs: coords
				};
				textures[ channel_name ] = tex_info;
			}
			material.textures = textures;
		}
	}
};

LS.Formats.addSupportedFormat( "gltf", parserGLTF );

var parserGLB = {
	extension: "glb",
	type: "scene",
	resource: "SceneNode",
	format: "binary",
	dataType:'arrayBuffer',

	parse: function( data, options, filename )
	{
		if(!data || data.constructor !== ArrayBuffer)
		{
			console.error("GLTF is not string");
			return null;
		}

		var clean_filename = LS.RM.getFilename( filename );

		//parser moved to Collada.js library
		var json = GLTFParser.parseGLB( data, options, clean_filename );
		var scene = GLTFParser.parseGLTF( json, options, clean_filename );
		console.log( scene ); 
	}
}

LS.Formats.addSupportedFormat( "glb", parserGLTF );

