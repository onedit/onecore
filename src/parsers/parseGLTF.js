var parserGLTF = {
	extension: "gltf",
	type: "scene",
	resource: "SceneNode",
	format: "text",
	dataType:'text',

	convert_filenames_to_lowercase: true,
	BYTE: 5120,
	UNSIGNED_BYTE: 5121,
	SHORT: 5122,
	UNSIGNED_SHORT: 5123,
	UNSIGNED_INT: 5125,
	FLOAT: 5126,

	JSON_CHUNK: 0x4E4F534A,
	BINARY_CHUNK: 0x004E4942,

	buffer_names: {
		POSITION: "vertices",
		NORMAL: "normals",
		COLOR_0: "colors",
		TEXCOORD_0: "coords",
		TEXCOORD_1: "coords1",
		WEIGHTS_0: "weights",
		JOINTS_0: "bones"
	},

	numComponents: { "SCALAR":1, "NUMBER":1,"VEC2":2,"VEC3":3,"VEC4":4, "QUAT":4, "MAT3":9, "TRANS10":10, "MAT4":16 },

	rename_animation_properties: { "translation":"position","scale":"scaling" },

	flip_uv: true,
	overwrite_materials: true,
	rename_assets: false, //force assets to have unique names (materials, meshes)

	prefabs: {},

	texture_options: { format: GL.RGBA, magFilter: GL.LINEAR, minFilter: GL.LINEAR_MIPMAP_LINEAR, wrap: GL.REPEAT },
	parse: function( data, options, filename )
	{
		if(!data || data.constructor !== String)
		{
			console.error("DAE parser requires string");
			return null;
		}


		var clean_filename = LS.RM.getFilename( filename );
		var extension = ONE.ResourcesManager.getExtension(filename)

    	var json = {};
		if(extension == "glb")
		{
			json = parserGLTF.parseGLB(str2ab(data));
			if(!json)
				return;
			//onFetchComplete();
			//return;
		}
		else
    	{
			json = JSON.parse(data)
			//gltf
			for(var i = 0; i < json.buffers.length; ++i)
			{
				var buffer = json.buffers[i];
				var data = null;
				if( buffer.uri.substr(0,5) == "data:")
				buffer.data = _base64ToArrayBuffer( buffer.uri.substr(37) );
				else
				{
				var file = LS.RM.getResource( buffer.uri );
				buffer.data = file.data;
				}

				buffer.dataview = new Uint8Array( buffer.data );
				/*
				if(data.byteLength != buffer.byteLength)
				console.warn("gltf binary doesnt match json size hint");
				*/
			}
		}	
		json.filename = filename;
		/*if(folder) json.folder = folder;
		if(url) json.url = url;*/
		var node = parserGLTF.parseGLTF( json );
		
		//apply 90 degrees rotation to match the Y UP AXIS of the system
			//if( node.metadata && node.metadata.up_axis == "Z_UP" )
		//		node.root.model = mat4.rotateX( mat4.create(), mat4.create(), -90 * 0.0174532925 );
		return node;
		//onFetchComplete();
		function str2ab(str) {
		var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
		var bufView = new Uint8Array(buf);
		for (var i=0, strLen=str.length; i < strLen; i++) {
			bufView[i] = str.charCodeAt(i);
		}
		return buf;
		}

		function fetchBinaries( list )
		{
			var buffer = list.pop();
			var bin_url = folder + "/" + buffer.uri;

			if( buffer.uri.substr(0,5) == "blob:")
				bin_url = buffer.uri;

			console.log(" - loading " + buffer.uri + " ...");
			if( buffer.uri.substr(0,5) == "data:")
			{
				var data = _base64ToArrayBuffer( buffer.uri.substr(37) );
				onBinary.call({buffer:buffer}, data );
			}
			else
				fetch( bin_url ).then(function(response) {
					return response.arrayBuffer();
				}).then(onBinary.bind({buffer:buffer}));

			function onBinary( data )
			{
				var buffer = this.buffer;
				buffer.data = data;
				buffer.dataview = new Uint8Array(data);
				//if(data.byteLength != buffer.byteLength) //it is always different ??
				//	console.warn("gltf binary doesnt match json size hint");
				if(list.length)
					fetchBinaries( list );
				else
					onFetchComplete();
			}
		}

		function onFetchComplete()
		{
			console.log("parsing gltf ...");
			json.filename = filename;
			/*if(folder) json.folder = folder;
			if(url) json.url = url;*/
			var node = parserGLTF.parseGLTF( json );
		//	parserGLTF.prefabs[ url ] = node.serialize();
			if(callback)
				callback(node);
		}

		function onData(data)
		{
			if( extension == "gltf" )
			{
				json = data;
				console.log("loading gltf binaries...");
				fetchBinaries( json.buffers.concat() );
			}
			else if( extension == "glb" )
			{
				json = parserGLTF.parseGLB(data);
				if(!json)
					return;
				onFetchComplete();
			}
		}
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

	parseGLB: function(data)
	{
		var view = new Uint8Array( data );

		//read header
		var endianess = true;
		var dv = new DataView( data );
		var magic = dv.getUint32(0,endianess);

	/*	if(magic != 0x46546C67)
		{
			console.error("incorrect gltf header");
			return null;
		}*/
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

			if(chunk_type == parserGLTF.JSON_CHUNK)
			{
				if (!("TextDecoder" in window))
				  throw("Sorry, this browser does not support TextDecoder...");

				var enc = new TextDecoder("utf-8");
				var str = enc.decode(chunk_data);
				json = JSON.parse(str);
			}
			else if(chunk_type == parserGLTF.BINARY_CHUNK)
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

	parseGLTF: function(json, filename)
	{
		console.log(json);

		if(!json.url)
			json.url = filename || "scene.glb";
   		 var clean_filename = LS.RM.getFilename(json.filename)
		//Create a scene tree
		var sceneTree = { 
			object_class:"Scene", 
			light: null,
			materials: {},
			meshes: {},
			resources: {}, //used to store animation tracks
     		root: {children: [] },
			external_files: {} //store info about external files mentioned in this 
		};
	
		var nodes_by_id = {};
		if( json.scenes.length > 1 )
			console.warn("gltf importer only supports one scene per file, skipping the rest");

		var scene = json.scenes[ json.scene ];
		var nodes_info = scene.nodes;
		this.gltf_materials = {};
		this.gltf_meshes = {};
		
    if(json.skins)
		{
      //json.bones = [];
			for(var i = 0; i < json.skins.length; ++i)
			{
				var skin = json.skins[i];
				for(var j = 0; j < skin.joints.length; ++j)
				{
          var node = json.nodes[ skin.joints[j] ];
					json.nodes[ skin.joints[j] ]._is_joint = true;
         /* var t = new LS.Transform();
          if(node.translation)
          	t.setPosition(node.translation);
          if(node.rotation)
          	t.setRotation(node.rotation);
          if(node.scale)
          	t.setScale(node.scale[0], node.scale[1], node.scale[2]);
          json.bones.push([node.name, t.getMatrix()])*/
				}
			}
		}
		//apply 90 degrees rotation to match the Y UP AXIS of the system
		if( json.metadata && json.metadata.up_axis == "Z_UP" )
			sceneTree.root.model = mat4.rotateX( mat4.create(), mat4.create(), -90 * 0.0174532925 );
    
    for(var i in json.meshes)
    {

      if(json.meshes[i].extras&&json.meshes[i].extras.targetNames)
      {
        var targets = json.meshes[i].extras.targetNames;
        var weights = json.meshes[i].weights;
        var primitives = json.meshes[i].primitives;
        var morphs = [];
  
        //get targets
        for(var t in targets)
        {
          var id = "#" + json.meshes[i].name + "__" + targets[t];
       
          morphs.push( { mesh: json.meshes.length, weight: weights[t]} );
          json.meshes.push({name:id, primitives: [{indices: primitives[0].indices, attributes: primitives[0].targets[t]}]});
        }
        json.meshes[i].morph_targets = morphs;
      }
    }
	//rename meshes, nodes, etc
	var renamed = {};
	var basename = clean_filename.substr(0, clean_filename.indexOf("."));

	//rename meshes names
	var renamed_meshes = {};
	for(var i in json.meshes)
	{
		var newmeshname = basename + "__" + json.meshes[i].name + ".wbin";
		newmeshname = newmeshname.replace(/[^a-z0-9\.\-]/gi,"_"); //newmeshname.replace(/ /#/g,"_");
		renamed[ i ] = newmeshname;
		//json.meshes[i].bones = json.bones;
      	renamed_meshes[ newmeshname ] = json.meshes[i];
	}
	json.meshes = renamed_meshes;

		/*for(var i in json.meshes)
		{
			var mesh = json.meshes[i];
			this.processMesh( mesh, renamed );
		}*/

	

	function inner_replace_names( node )
	{
		if(node.id == "root")
		{
			console.warn("DAE contains a node named root, renamed to _root");
			node.id = "_root";
			renamed["root"] = node.id;
		}

		//change uid
		if(node.id )
		{
			node.uid = "@" + basename + "::" + node.id;
			renamed[ node.id ] = node.uid;
		}
		if(node.name)
		{
			node.name = node.name.replace(/[^a-z0-9\.\-]/gi,"_");
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

		

		//replace animation name
		if(	sceneTree.root.animation )
			sceneTree.root.animation = this.renameResource( sceneTree.root.animation, sceneTree.root.animation + ".wbin", sceneTree.resources );

		//Materials need some renames
		/*var renamed_materials = {};
		for(var i in json.materials)
		{
			var mat = json.materials[i];
			//this.processMaterial( mat );
			renamed_materials[ mat.id ] = mat;
			//this.renameResource( i, mat.id, scene.resources ); //materials are not stored in the resources container
		}
		json.materials = renamed_materials;*/

		//check resources
		for(var i in sceneTree.resources)
		{
			var res = sceneTree.resources[i];
			var ext = LS.ResourcesManager.getBasename( i );
			if(!ext)
				console.warn("DAE contains resources without extension: " + i, res.constructor );
			if(res.object_class == "Animation")
				this.processAnimation( res, renamed );
		}
	/*	if(nodes_info.length > 1) //multiple root nodes
		{
			root = new LS.SceneNode("root");
			root.root = root;
		}
*/	
    var renamed_nodes = {};
		for(var i = 0; i < nodes_info.length; ++i)
		{
			var info = nodes_info[i];
			var index = info;
			if(info.node != null)
				index = info.node;
      var node = parserGLTF.parseNode( {}, index, json, renamed );
    
			if(nodes_info.length > 1)
				sceneTree.root.children.push( node );
			node.id = json.url.replace(/\//gi,"_") + "::node_" + i;
			nodes_by_id[ node.id ] = nodes_by_id[ i ] = node;
      renamed_nodes[i] = node.id;
		}
  /*//replace skinning joint ids
      for(var i in json.meshes)
      {
        var mesh = json.meshes[i];
        if(mesh.bones)
        {
          for(var j in mesh.bones)
          {
            var id = mesh.bones[j][0];
            var uid = renamed_nodes[ id ];
            if(uid)
            {

              mesh.bones[j][0] = uid;
            }
          }
        }
      }*/
		if(json.animations && json.animations.length)
		{
			if(!LS.Animation)
				console.error("you must include rendeer-animation.js to allow animations");
			else
			{
				
				for(var i = 0; i < json.animations.length; ++i)
				{
					var animation = this.parseAnimation(i,json,nodes_by_id);
					
					if(animation)
					{
            animation.uid = animation.id = json.filename.substr(0,json.filename.indexOf(".")) + "::" + animation.name;
						//LS.Animations[ animation.id ] = animation;	
          //  sceneTree.root.animation = animation.id;

            var animations_name = "animations_" + json.filename.substr(0,json.filename.indexOf("."));
            sceneTree.resources[ animations_name ] = animation;
            sceneTree.root.animation = animations_name;
             LS.RM.registerResource(animations_name, animation)
	
					}
				}
			}
		}
	
		sceneTree.materials = this.gltf_materials;
    sceneTree.meshes = this.gltf_meshes;
    	//change local collada ids to valid uids 
	//	inner_replace_names( sceneTree.root );
    console.log(sceneTree)
		return sceneTree;
	},

	parseNode: function(node, index, json, renamed = null, bind_matrix = null)
	{
		var info = json.nodes[ index ];

    if(info.skin==undefined)
    {
      var mat = new LS.Transform();
      if(info.translation)
        mat.setPosition(info.translation);
      if(node.rotation)
        mat.setRotation(info.rotation);
      if(info.scale)
        mat.setScale(info.scale[0], info.scale[1], info.scale[2]);
   //   mat4.invert(mat, mat.getMatrix())
     // info.bind_matrix = mat4.invert(mat4.create(),mat.getMatrix());
        
    }
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
				case "scale": node.scaling = v;
					var numneg = 0; //GLTFs and negative scales are pain in the ass
					if (node.scaling[0] < 0)
						numneg++;
					if (node.scaling[1] < 0)
						numneg++;
					if (node.scaling[2] < 0)
						numneg++;
					if( numneg%2 == 1)
						node.flags.frontFace = GL.CW; //reverse
					break;
				case "matrix": 
					node.fromMatrix( v );
					var det = mat4.determinant( v );
					if( det < 0 )
						node.flags.frontFace = GL.CW; //reverse
					break;
				case "mesh": 
          if(renamed!=null || renamed!=undefined )
            v = renamed[v];
          if(info.skin!=undefined)
            json.meshes[v].skin = info.skin;
          if(bind_matrix!=undefined || bind_matrix!=null)
            json.meshes[v].bind_matrix = bind_matrix;
					var mesh = parserGLTF.parseMesh(v, json);
					if(mesh)
					{
						node.mesh = mesh.name;
						node.primitives = [];
						for(var j = 0; j < mesh.info.groups.length; ++j)
						{
							var group = mesh.info.groups[j];
							var material = null;
							if(group.material != null)
								material = this.parseMaterial( group.material, json );
							node.primitives.push({
								index: j, 
								material: material ? material.name : null, //meshes without material can exists
								mode: group.mode
							});
              if(material)
              {
                node.material = material.name;
                this.gltf_materials[material.name] = material;
              }
             }
            
            this.gltf_meshes[mesh.name] = mesh;
            if(mesh.morph_targets)
            {
              for(var t = 0; t < mesh.morph_targets.length; ++t)
              {
                v = mesh.morph_targets[t].mesh;
                if(renamed!=null || renamed!=undefined )
                {
            			v = renamed[v];
                  
                }
                var m_target = parserGLTF.parseMesh(v, json, mesh.name);
                this.gltf_meshes[m_target.name] = m_target;
                mesh.morph_targets[t].mesh = m_target.name;
              }
            }
            
					}
					break;
				case "skin":
					node.skin = this.parseSkin( v, json );
          
					break;
				case "children": 
					if(v.length)
					{
            
              
            node.children = [];
						for(var j = 0; j < v.length; ++j)
						{
							var subnode_info = json.nodes[ v[j] ];
              var subnode = parserGLTF.parseNode( {}, v[j], json, renamed , info.bind_matrix);
							//node.addChild(subnode);
              node.children.push(subnode)
						}
					}
					break;
				case "extras":
					break;
				case "_is_joint":
          node.node_type = "JOINT";
					break;
        case "camera":
         	var camera = json.cameras[v]; 
          node.camera = {};
          if(camera.perspective)
          {
            node.camera.type = ONE.Camera.PERSPECTIVE;
            node.camera.fov = camera.perspective.yfov;
            node.camera.far = camera.perspective.zfar;
            node.camera.near = camera.perspective.znear;
          }
          else
          {
            node.camera.type = ONE.Camera.ORTHOGRAPHIC; 	
          }
          break;
				default:
					if( i[0] != "_" )
						console.log("gltf node info ignored:",i,info[i]);
					break;
			}
		}

		if(!info.name)
			info.name = node.name = "node_" + index;

		if(info._is_joint)
			node.is_joint = true;
    

		return node;
	},

	parseMesh: function(index, json, parent = null)
	{
		var mesh_info = json.meshes[index];
		var meshes_container = gl.meshes;

		//extract primitives
		var meshes = [];
		var prims = [];
		var start = 0;
		for(var i = 0; i < mesh_info.primitives.length; ++i)
		{
			var prim = this.parsePrimitive( mesh_info, i, json );
			if(!prim)
				continue;
			prim.start = start;
			start += prim.length;
			prims.push(prim);
			var mesh_primitive = { vertexBuffers: {}, indexBuffers:{} };
			for(var j in prim.buffers)
				if( j == "indices" || j == "triangles" )
					mesh_primitive.indexBuffers[j] = { data: prim.buffers[j] };
        else{
          if( j == "bones" )
             mesh_primitive.vertexBuffers["bone_indices"] = { data: prim.buffers[j] };
          else 
            mesh_primitive.vertexBuffers[j] = { data: prim.buffers[j] };
        }
			meshes.push({ mesh: mesh_primitive });
		}

		//merge primitives
		var mesh = null;
		if(meshes.length > 1)
			mesh = GL.Mesh.mergeMeshes( meshes );
		else if (meshes.length == 1)
		{
			var mesh_data = meshes[0].mesh;
			mesh = new GL.Mesh( mesh_data.vertexBuffers, mesh_data.indexBuffers );
			if( mesh.info && mesh_data.info)
				mesh.info = mesh_data.info;
		}

		if(!mesh)
			return null;

		for(var i = 0; i < mesh_info.primitives.length; ++i)
		{
			var g = mesh.info.groups[i];
			if(!g)
				mesh.info.groups[i] = g = {};
			var prim = mesh_info.primitives[i];
			g.material = prim.material;
			g.mode = prim.mode != null ? prim.mode : 4; //GL.TRIANGLES
			g.start = prims[i].start;
			g.length = prims[i].length;
		}

		mesh.name = mesh_info.name;
		if(mesh.name || this.rename_assets)
			mesh.name = json.filename.substr(0,json.filename.indexOf(".")) + "::mesh_" + (mesh_info.name || index) ;
		//mesh.material = primitive.material;
		//mesh.primitive = mesh_info.mode;
		mesh.updateBoundingBox();
		mesh.computeGroupsBoundingBoxes();
    
    if(mesh_info.morph_targets)
      mesh.morph_targets = mesh_info.morph_targets;
    
    mesh.object_class = "Mesh";
		
    if(mesh_info.skin!=undefined)
    {
      var bones = mesh_info.bones
      if(!mesh_info.bones)
      {
      	var skin = this.parseSkin( mesh_info.skin, json );
        bones = skin.bones;
      }
      mesh.bones = bones;
      mesh.search_bones_in_parent = true;
    }
    if(mesh_info.bind_matrix)
      mesh.bind_matrix = mesh_info.bind_matrix;
    meshes_container[ mesh.name ] = mesh;
    LS.RM.meshes[mesh.name] = mesh;
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
			if(primitive_info.extensions["KHR_draco_mesh_compression"])
			{
				if(typeof(DracoDecoderModule) == "undefined")
					throw("mesh data is compressed using Draco, draco_decoder.js not installed.");
				buffers = primitive.buffers = this.decompressDraco( primitive_info, json );
			}
			else
			{
				throw("mesh data is compressed, this importer does not support it yet");
				return null;
			}
		}
		else
		{
			if(!primitive_info.attributes.POSITION == null)
				console.warn("gltf mesh without positions");

			for(var i in this.buffer_names)
			{
				var prop_name = this.buffer_names[i];
				var flip = prop_name == "coords" || prop_name == "coords1";
				var att_index = primitive_info.attributes[i];
				if(att_index == null)
					continue;
				var data = this.parseAccessor( att_index, json, flip );
				if(data)
					buffers[prop_name] = data;
			}

			//indices
			if(primitive_info.indices != null)
				buffers.triangles = this.parseAccessor( primitive_info.indices, json );
		}

		if(!buffers.vertices)
		{
			console.error("primitive without vertices");
			return null;
		}

		primitive.mode = primitive_info.mode;
		primitive.material = primitive_info.material;
		primitive.start = 0;
		primitive.length = buffers.triangles ? buffers.triangles.length : buffers.vertices.length / 3;
		return primitive;
	},

	installDracoModule: function( callback )
	{
		var types = this.draco_data_types = {};

		var that = this;
		//fetch module
		if(this.decoderModule)
		{
			if(callback)
				callback(this.decoderModule);
			return;
		}

		if(typeof(DracoDecoderModule) != "undefined")
			DracoDecoderModule({}).then(function(module) {
				var draco = that.decoderModule = module;
				types[ draco.DT_INT8	] = Int8Array;
				types[ draco.DT_UINT8	] = Uint8Array;
				types[ draco.DT_INT16	] = Int16Array;
				types[ draco.DT_UINT16	] = Uint16Array;
				types[ draco.DT_INT32	] = Int32Array;
				types[ draco.DT_UINT32	] = Uint32Array;
				types[ draco.DT_FLOAT32	] = Float32Array;
				if(callback)
					callback(module);
			});
		else
			console.error("Draco3D not installed");
	},

	decompressDraco: function( primitive_info, json )
	{
		if(!this.draco_decoder)
			this.draco_decoder = new this.decoderModule.Decoder();
		var result = this.decodePrimitive( this.draco_decoder, primitive_info, json );
		return result;
	},

	decodePrimitive: function( decoder, primitive_info, json )
	{
		console.log(primitive_info);
		var ext_data = primitive_info.extensions.KHR_draco_mesh_compression;
		var buffers = {};

		//every mesh is stored in an independent buffer view
		var bufferView = json.bufferViews[ ext_data.bufferView ];
		var buffer = json.buffers[ bufferView.buffer ];
		var rawBuffer = buffer.dataview.buffer;

		//transform buffer view to geometry
		var draco = this.decoderModule;
		var buffer = new draco.DecoderBuffer();
		buffer.Init(new Int8Array(rawBuffer), rawBuffer.byteLength);
		var geometryType = decoder.GetEncodedGeometryType(buffer);
		if (geometryType == draco.TRIANGULAR_MESH) {
			//extract
			var uncompressedDracoMesh = new draco.Mesh();
			var status = decoder.DecodeBufferToMesh( buffer, uncompressedDracoMesh );
			if ( !status.ok() || uncompressedDracoMesh.ptr === 0 ) {
				throw new Error( 'GLTF Draco: Decoding failed: ' + status.error_msg() );
			}

			var size = uncompressedDracoMesh.num_points() * 3;

			//transform from draco geometry to my own format
			for(var i in this.buffer_names)
			{
				var prop_name = this.buffer_names[i];
				var draco_buffer_name = i;
				if( draco_buffer_name == "COLOR_0")
					draco_buffer_name = "COLOR";
				else if( draco_buffer_name == "TEXCOORD_0")
					draco_buffer_name = "TEX_COORD";
				var flip = prop_name == "coords" || prop_name == "coords1";
				var buff = this.decodeBuffer( uncompressedDracoMesh, draco[ draco_buffer_name ], flip, decoder );
				if(buff)
					buffers[prop_name] = buff.data;
			}

			//get indices
			var numFaces = uncompressedDracoMesh.num_faces();
			var numIndices = numFaces * 3;
			var byteLength = numIndices * 4;

			var ptr = draco._malloc( byteLength );
			decoder.GetTrianglesUInt32Array( uncompressedDracoMesh, byteLength, ptr );
			buffers.triangles = new Uint32Array( draco.HEAPF32.buffer, ptr, numIndices ).slice();
			draco._free( ptr );
		}

		draco.destroy( buffer );
		draco.destroy( uncompressedDracoMesh );
		return buffers;
	},

	decodeBuffer: function( uncompressedDracoMesh, index, flip, decoder )
	{
		if(index == null)
			return null;
		var draco = this.decoderModule;
		//transform from draco geometry to my own format
		var attId = decoder.GetAttributeId( uncompressedDracoMesh, index );
		if(attId == -1)
			return null;
		var att = decoder.GetAttribute( uncompressedDracoMesh, attId );
		var data_type = att.data_type();
		var num_comps = att.num_components();
		var num_points = uncompressedDracoMesh.num_points();
		var size = att.size();
		var total_length = num_points * num_comps;
		var ctor = this.draco_data_types[ data_type ];
		var bytes = total_length * ctor.BYTES_PER_ELEMENT;

		//*
		var attData = new draco.DracoFloat32Array();
		decoder.GetAttributeFloatForAllPoints( uncompressedDracoMesh, att, attData );
		var data = new ctor( total_length );
		for(var i = 0; i < data.length; ++i)
			data[i] = attData.GetValue(i);
		//*/
		/*
		var ptr = draco._malloc( bytes );
		decoder.GetAttributeDataArrayForAllPoints( uncompressedDracoMesh, att, data_type, bytes, ptr );
		var data = new ctor( draco.HEAPF32.buffer, ptr, total_length ).slice();
		draco._free( ptr );
		//*/

		if(flip)
			for(var i = 1; i < data.length; i+=num_comps)
				data[i] = 1.0 - data[i];

		return {
			num_points: num_points,
			num_comps: num_comps,
			data_type: data_type,
			data: data
		};
	},

	parseAccessor: function( index, json, flip_y, bufferView, decoder )
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
			case parserGLTF.FLOAT: databuffer = new Float32Array( size ); break;
			case parserGLTF.UNSIGNED_INT: databuffer = new Uint32Array( size ); break;
			case parserGLTF.SHORT: databuffer = new Int16Array( size );  break;
			case parserGLTF.UNSIGNED_SHORT: databuffer = new Uint16Array( size );  break;
			case parserGLTF.BYTE: databuffer = new Int8Array( size );  break;
			case parserGLTF.UNSIGNED_BYTE: databuffer = new Uint8Array( size );  break;
			default:
				console.warn("gltf accessor of unsupported type: ", accessor.componentType);
				databuffer = new Float32Array( size );
		}

		if(bufferView == null)
			bufferView = json.bufferViews[ accessor.bufferView ];

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

		//decode?
		//if(decoder)
		//	databufferview = this.decodeBuffer( databufferview.buffer, decoder );

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

		var mat_name = info.name;
		if(!mat_name || this.rename_assets)
			mat_name = json.filename.substr(0,json.filename.indexOf(".")) + "::mat_" + (info.name || index);
		else
      mat_name = json.filename.substr(0,json.filename.indexOf("."))+ "_"+mat_name.replace(/[^a-z0-9\.\-]/gi,"_") + ".json";
    
		var material = LS.RM.getMaterial( mat_name );
		if(material && (!this.overwrite_materials || material.from_filename == json.filename.substr(0,json.filename.indexOf("."))) )
			return material;

		material = new LS.StandardMaterial();
		material.name = mat_name;
		material.from_filename = json.filename.substr(0,json.filename.indexOf("."));
		//material.shader_name = "phong";

		if(info.alphaMode != null)
			material.alphaMode = info.alphaMode;
		material.alphaCutoff = info.alphaCutoff != null ? info.alphaCutoff : 0.5;
		if(info.doubleSided != null)
			material.flags.two_sided = info.doubleSided;
		material.normalmapFactor = 1.0;

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
			{
				//material.textures.albedo = this.parseTexture( info.pbrMetallicRoughness.baseColorTexture, json );
        material.textures.color = this.parseTexture( info.pbrMetallicRoughness.baseColorTexture, json );
				if( material.alphaMode == "MASK" && gl.extensions.EXT_texture_filter_anisotropic ) //force anisotropy
				{
					//var tex = gl.textures[ material.textures.albedo.texture ];
          var tex = gl.textures[ material.textures.color.texture ];
					if(tex)
					{
						tex.bind(0);
						gl.texParameteri( gl.TEXTURE_2D, gl.extensions.EXT_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, 8 );
					}
				}
			}
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

		LS.RM.materials[ material.name ] = material;
		this.gltf_materials[ material.name ] = material;

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
      if(source.name)
        image_name = source.name;
      else
				image_name = json.url.replace(/[\/\.\:]/gi,"_") + "_image_" + mat_tex_info.index;// + ".png";
			if( source.mimeType )
				extension = (source.mimeType.split("/").pop());
			else
				extension = "png"; //defaulting
			image_name += "." + extension;
		}


		var result = {};

		var tex = gl.textures[ image_name ];
		if( !tex )
		{
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
				{
					if(filename.substr(0,5) == "blob:")
						result.texture = filename;
					else
						result.texture = json.folder + "/" + filename;
				}
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
		}

		if(!result.texture)
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
    var bones = [];
		if( info.skeleton != null )
			skin.skeleton_root = json.nodes[ info.skeleton ].name;
		skin.bindMatrices = this.splitBuffer( this.parseAccessor( info.inverseBindMatrices, json ), 16 );
		skin.joints = [];
		for(var i = 0; i < info.joints.length; ++i)
		{
			var joint = json.nodes[ info.joints[i] ];
			skin.joints.push( joint.name );//skin.joints.push( joint.id );
      bones.push([joint.name, skin.bindMatrices[i]])
		}
    skin.bones = bones;
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

	//parses an animation and returns it as a RD.Animation
	parseAnimation: function(index, json, nodes_by_id )
	{
		var info = json.animations[index];
		var animation = new LS.Animation();
		animation.name = info.name || "anim_" + index;
		var duration = 0;

		for(var i = 0; i < info.channels.length; ++i)
		{
			var track = new LS.Animation.Track();
			var channel = info.channels[i];
			var sampler = info.samplers[channel.sampler];

			track.target_node = json.nodes[ channel.target.node ].name;
			track.target_property = channel.target.path.toLowerCase();
			
			var renamed = this.rename_animation_properties[ track.target_property ];
			if(renamed)
				track.target_property = renamed;
      track._property_path = [track.target_node, channel.target.path];
			track._property= track.target_node+"/"+ channel.target.path
			var timestamps = this.parseAccessor( sampler.input, json );
			var keyframedata = this.parseAccessor( sampler.output, json );
			var type = json.accessors[ sampler.output ].type;
			var type_enum = LS.TYPES[type];
			if( type_enum == LS.TYPES["VEC4"] && track.target_property == "rotation")
				type_enum = LS.TYPES["QUAT"];
			track.type = type_enum;
			var num_components = this.numComponents[ type ];

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
				var value = keyframedata.subarray(j*num_components,j*num_components+num_components);
				//if(type_enum == LS.QUAT)
				//	quat.identity(value,value);
				keyframes.set( value, j*(1+num_components)+1 );
			}
			track.data = keyframes;
			track.packed_data = true;
      track.value_size = num_components;
			duration = Math.max( duration, timestamps[ timestamps.length - 1] );

			//animation.addTrack( track );
      animation.addTrackToTake("default",track)
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
	},

	//special case when using a data path
	removeRootPathFromTextures: function( materials, root_path )
	{
		if(!root_path)
			return;
		for(var i in materials)
		{
			var mat = materials[i];
			for(var j in mat.textures)
			{
				var sampler = mat.textures[j];
				if(!sampler)
					continue;
				if( sampler.constructor === String && sampler.indexOf( ROOM.root_path ) == 0 && sampler.texture.indexOf("/") != -1 )
				{
					sampler = { texture: sampler.substr( ROOM.root_path.length ) };
					continue;
				}
				if(!sampler.texture)
					continue;
				if( sampler.texture.indexOf( ROOM.root_path ) == 0 && sampler.texture.indexOf("/") != -1 )
					sampler.texture = sampler.texture.substr( ROOM.root_path.length );
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

//load module
if(typeof(DracoDecoderModule) != "undefined")
	parserGLTF.installDracoModule(parserGLTF.onReady);

LS.Formats.addSupportedFormat( "gltf", parserGLTF );
LS.Formats.addSupportedFormat( "glb", parserGLTF );

LS.SceneNode.prototype.setPropertyValueFromPath = function( path, value, offset )
{
	offset = offset || 0;

	if(this.flags && this.flags.locked)
		return; //lock ignores changes from animations or graphs

	var target = null;
	var varname = path[offset];

	if(path.length > (offset+1))
	{
		if(path[offset][0] == "@")
		{
			varname = path[offset+1];
			target = this.getComponentByUId( path[offset] );
		}
		else if( path[offset] == "material" )
		{
			target = this.getMaterial();
			varname = path[offset+1];
		}
		else if( path[offset] == "flags" )
		{
			target = this.flags;
			varname = path[offset+1];
		}
		else if( path[offset] == "visible" )
		{
			target = this;
			varname = path[offset];
		}
		else 
		{
			target = this.getComponent( path[offset] );
			varname = path[offset+1];
		}

		if(!target)
			return null;
	}
	else { //special cases 
		switch ( path[offset] )
		{
			case "matrix": target = this.transform; break;
			case "position":
            target = this.transform; 
				varname = path[offset];
				break;
			case "rotation":
			target = this.transform; 
				varname = path[offset];
				break;
			case "x":
			case "y":
			case "z":
			case "xrotation": 
			case "yrotation": 
			case "zrotation": 
				target = this.transform; 
				varname = path[offset];
				break;
			case "translate.X": target = this.transform; varname = "x"; break;
			case "translate.Y": target = this.transform; varname = "y"; break;
			case "translate.Z": target = this.transform; varname = "z"; break;
			case "rotateX.ANGLE": target = this.transform; varname = "pitch"; break;
			case "rotateY.ANGLE": target = this.transform; varname = "yaw"; break;
			case "rotateZ.ANGLE": target = this.transform; varname = "roll"; break;
			default: target = this; //null
		}
	}

	if(!target)
		return null;

	if(target.setPropertyValueFromPath && target != this)
		if( target.setPropertyValueFromPath( path, value, offset+1 ) === true )
			return target;
	
	if(target.setPropertyValue  && target != this)
		if( target.setPropertyValue( varname, value ) === true )
			return target;

	if( target[ varname ] === undefined )
		return;

	//special case when the component doesnt specify any locator info but the property referenced does
	//used in TextureFX
	if ( path.length > 2 && target[ varname ] && target[ varname ].setPropertyValueFromPath )
		return target[ varname ].setPropertyValueFromPath( path, value, offset+2 );

	//disabled because if the vars has a setter it wont be called using the array.set
	//if( target[ varname ] !== null && target[ varname ].set )
	//	target[ varname ].set( value );
	//else
		target[ varname ] = value;

	return target;
}



