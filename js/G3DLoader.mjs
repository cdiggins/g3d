import {
	BufferAttribute,
	BufferGeometry,
	FileLoader,
    Uint32BufferAttribute,
	Group,
    Loader,
    MeshPhongMaterial,
    LineBasicMaterial,
    DoubleSide,
    Mesh,
    InstancedMesh,
    Color,
    Matrix4
} from 'three';

class BFastHeader 
{
    magic;
    dataStart;
    dataEnd;
    numArrays;
    isValid;
    error;

    constructor(magic, dataStart, dataEnd, numArrays, byteLength) 
    {
        this.isValid = false;
        if (magic !== 0xbfa5)
            this.error = 'Not a BFAST file, or endianness is swapped';
        else if (dataStart <= 32 || dataStart > byteLength)
            this.error = 'Data start is out of valid range';
        else if (dataEnd < dataStart || dataEnd > byteLength)
            this.error = 'Data end is out of valid range';
        else if (numArrays < 0 || numArrays > dataEnd)
            this.error = 'Number of arrays is invalid';
        else
            this.isValid = true;
        this.magic = magic;
        this.dataStart = dataStart;
        this.dataEnd = dataEnd;
        this.numArrays = numArrays;
    }
    static fromBytes(bytes, byteLength) {
        const ints = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        return BFastHeader.fromArray(ints, byteLength);
    }
    static fromArray(array, byteLength) {
        if (array.length < 8) {
            let r = new this(0, 0, 0, 0, 0);
            r.isValid = false;
            r.error = "Insufficient length";
            return r;
        }
        else {
            return new this(array[0], array[2], array[4], array[6], byteLength);
        }
    }
}

class BFast 
{
    // meta-information about the BFAST 
    header;

    // an array of strings, each the name of a buffer
    names;

    // an array of Uint8Array
    buffers;

    // a lookup table of sub-bfast 
    children;

    constructor(header, names, buffers) {
        this.header = header;
        this.names = names;
        this.buffers = buffers;
        if (names.length != buffers.length)
            throw new Error("number of names, and number of buffers must match");
        this.children = new Map();
    }

    getBuffer(name) {
        const index = this.names.indexOf(name);
        if (index < 0) return undefined;
        return this.buffers[index];
    }
    getChild(name) {
        return this.children.get(name);
    }
    static isBfast(bytes) {
        const header = BFastHeader.fromBytes(bytes, bytes.length);
        return header.isValid;
    }
    static parseFromArray(bytes) {
        return this.parseFromBuffer(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    static parseFromBuffer(arrayBuffer, byteOffset = 0, byteLength = arrayBuffer.byteLength - byteOffset) {
        // Cast the input data to 32-bit integers
        // Note that according to the spec they are 64 bit numbers. In JavaScript you can't have 64 bit integers,
        // and it would bust the amount of memory we can work with in most browsers and low-power devices
        const data = new Int32Array(arrayBuffer, byteOffset, byteLength / 4);
        // Parse the header
        const header = BFastHeader.fromArray(data, byteLength);
        if (!header.isValid)
            throw new Error(header.error);
        // Compute each buffer
        const buffers = [];
        let pos = 8;
        for (let i = 0; i < header.numArrays; ++i) {
            const begin = data[pos + 0];
            const end = data[pos + 2];
            // Check validity of data
            if (data[pos + 1] !== 0)
                throw new Error('Expected 0 in position ' + (pos + 1) * 4);
            if (data[pos + 3] !== 0)
                throw new Error('Expected 0 in position ' + (pos + 3) * 4);
            if (begin < header.dataStart || begin > header.dataEnd)
                throw new Error('Buffer start is out of range');
            if (end < begin || end > header.dataEnd)
                throw new Error('Buffer end is out of range');
            pos += 4;
            const buffer = new Uint8Array(arrayBuffer, begin + byteOffset, end - begin);
            buffers.push(buffer);
        }
        
        if (buffers.length < 0)
            throw new Error('Expected at least one buffer containing the names');

        // break the first one up into names
        const joinedNames = new TextDecoder('utf-8').decode(buffers[0]);
        
        // Removing the trailing '\0' before spliting the names
        let names = joinedNames.slice(0, -1).split('\0');
        if (joinedNames.length === 0)
            names = [];

        // Validate the number of names
        if (names.length !== buffers.length - 1) {
            throw new Error('Expected number of names to be equal to the number of buffers - 1');
        }

        var slices = buffers.slice(1);
        var result = new BFast(header, names, slices);
        for (var i = 0; i < names.length; ++i) {
            var buffer = slices[i];
            if (this.isBfast(buffer)) {
                var bfast = BFast.parseFromArray(buffer);
                result.children.set(names[i], bfast);
            }
        }
        return result;
    }
}

/**
 * A class that represents the information about a G3D attribute parsed from the URN
 */
class G3DAttributeDescriptor 
{
    // original descriptor string
    urn;

    // Indicates the part of the geometry that this attribute is associated with
    association;

    // the role of the attribute
    semantic;

    // each attribute type should have it's own index ( you can have uv0, uv1, etc. )
    attributeTypeIndex;

    // the type of individual values (e.g. int32, float64)
    dataType;

    // how many values associated with each element (e.g. UVs might be 2, geometry might be 3, quaternions 4, matrices 9 or 16)
    dataArity;
    
    constructor(urn) {
        if (!urn.startsWith('g3d:')) 
            throw new Error(`G3D attribute URN must start with 'g3d': ${urn}`);
        const split = urn.split(':');
        if (split.length != 6) 
            throw new Error(`G3D attribute URN must have 6 components: ${urn}`);
        this.urn = urn;
        this.association = split[1];
        this.semantic = split[2];
        this.attributeTypeIndex = split[3];
        this.dataType = split[4];
        this.dataArity = parseInt(split[5]);
    }
}

class G3DAttribute 
{
    descriptor;   
    bytes;        
    data;

    constructor(urn, bytes) {
        this.descriptor = new G3DAttributeDescriptor(urn);
        this.bytes = bytes;
        this.data = G3DAttribute.castData(this.bytes, this.descriptor.dataType);
    }

    // Converts a VIM attribute into a typed array from its raw data
    static castData(bytes, dataType) {
        // This is a UInt8 array
        switch (dataType) {
            case 'float32':
                return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
            case 'float64':
                throw new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
            case 'int8':
                return bytes;
            case 'int16':
                return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
            case 'int32':
                return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
            //case "int64": return new Int64Array(data.buffer, data.byteOffset, data.byteLength / 8);
            default:
                throw new Error('Unrecognized attribute data type ' + dataType);
        }
    }
}

class CommonG3DAttributes 
{
    static positions = 'g3d:vertex:position:0:float32:3';
    static indices = 'g3d:corner:index:0:int32:1';
    static instanceMeshes = 'g3d:instance:mesh:0:int32:1';
    static instanceTransforms = 'g3d:instance:transform:0:float32:16';
    static meshSubmeshes = 'g3d:mesh:submeshoffset:0:int32:1';
    static submeshIndexOffsets = 'g3d:submesh:indexoffset:0:int32:1';
    static submeshMaterials = 'g3d:submesh:material:0:int32:1';
    static materialColors = 'g3d:material:color:0:float32:4';
    static all = [
        CommonG3DAttributes.positions,
        CommonG3DAttributes.indices,
        CommonG3DAttributes.instanceMeshes,
        CommonG3DAttributes.instanceTransforms,
        CommonG3DAttributes.meshSubmeshes,
        CommonG3DAttributes.submeshIndexOffsets,
        CommonG3DAttributes.submeshMaterials,
        CommonG3DAttributes.materialColors
    ];
}

/**
 * G3D is a simple, efficient, generic binary format for storing and transmitting geometry.
 * The G3D format is designed to be used either as a serialization format or as an in-memory data structure.
 * See https://github.com/vimaec/g3d for the g3d specification.
 */
class G3D 
{
    attributes;
    positions;
    indices;
    instanceMeshes;
    instanceTransforms;
    meshSubmeshes;
    submeshIndexOffset;
    submeshMaterial;
    materialColors;
    // computed fields
    meshVertexOffsets;
    meshInstances;
    meshTransparent;
    MATRIX_SIZE = 16;
    COLOR_SIZE = 4;
    POSITION_SIZE = 3;

    DEFAULT_COLOR = new Float32Array([0.8, 0.8, 0.8, 1]);

    constructor(attributes)
    {
        this.attributes = attributes;
        this.positions = this.findAttribute(CommonG3DAttributes.positions)?.data;
        const tmp = this.findAttribute(CommonG3DAttributes.indices)?.data;
        // TODO: use computed indices OR is it a point cloud?
        this.indices = new Uint32Array(tmp.buffer, tmp.byteOffset, tmp.length);
        this.meshSubmeshes = this.findAttribute(CommonG3DAttributes.meshSubmeshes)?.data ?? [0];
        this.submeshIndexOffset = this.findAttribute(CommonG3DAttributes.submeshIndexOffsets)?.data ?? [0];
        this.submeshMaterial = this.findAttribute(CommonG3DAttributes.submeshMaterials)?.data;
        this.materialColors = this.findAttribute(CommonG3DAttributes.materialColors)?.data ?? [];
        this.instanceMeshes = this.findAttribute(CommonG3DAttributes.instanceMeshes)?.data ?? [];
        this.instanceTransforms = this.findAttribute(CommonG3DAttributes.instanceTransforms)?.data;
        this.meshVertexOffsets = this.computeMeshVertexOffsets();
        this.rebaseIndices();
        this.meshInstances = this.computeMeshInstances();
        this.meshTransparent = this.computeMeshIsTransparent();
        //this.validate();
    }
    
    findAttribute = (urn) => this.attributes.find(attr => attr.descriptor.urn == urn);
    
    /**
     * Computes the index of the first vertex of each mesh
     */
    computeMeshVertexOffsets() {
        const result = new Int32Array(this.getMeshCount());
        if (result.length == 1) {
            return [0];
        }
        for (let m = 0; m < result.length; m++) {
            let min = Number.MAX_SAFE_INTEGER;
            const start = this.getMeshIndexStart(m);
            const end = this.getMeshIndexEnd(m);
            for (let i = start; i < end; i++) {
                min = Math.min(min, this.indices[i]);
            }
            result[m] = min;
        }
        return result;
    }

    /**
     * Rebase indices to be relative to its own mesh instead of to the whole g3d
     */
    rebaseIndices() {
        const count = this.getMeshCount();
        if (count <= 1) return;
        for (let m = 0; m < count; m++) {
            const offset = this.meshVertexOffsets[m];
            const start = this.getMeshIndexStart(m);
            const end = this.getMeshIndexEnd(m);
            if (offset != 0) {
                for (let i = start; i < end; i++) {
                    this.indices[i] -= offset;
                }
            }
        }
    }

    /**
     * Computes all instances pointing to each mesh.
     */
    computeMeshInstances() {
        const result = [];
        for (let i = 0; i < this.instanceMeshes.length; i++) {
            const mesh = this.instanceMeshes[i];
            if (mesh < 0)
                continue;
            const instanceIndices = result[mesh];
            if (instanceIndices)
                instanceIndices.push(i);
            else
                result[mesh] = [i];
        }
        return result;
    };

    /**
     * Computes an array where true if any of the materials used by a mesh has transparency.
     */
    computeMeshIsTransparent() {
        const result = new Array(this.getMeshCount());
        for (let m = 0; m < result.length; m++) {
            const subStart = this.getMeshSubmeshStart(m);
            const subEnd = this.getMeshSubmeshEnd(m);
            for (let s = subStart; s < subEnd; s++) {
                const color = this.getSubmeshColor(s);
                const alpha = color[3];
                result[m] = result[m] || alpha < 1;
            }
        }
        return result;
    }
    
    // ------------- All -----------------
    getVertexCount = () => this.positions.length / this.POSITION_SIZE;
    
    // ------------- Meshes -----------------
    getMeshCount = () => this.meshSubmeshes ? this.meshSubmeshes.length : 1;
    getMeshIndexStart = (mesh) => this.getSubmeshIndexStart(this.getMeshSubmeshStart(mesh));
    getMeshIndexEnd = (mesh) => this.getSubmeshIndexEnd(this.getMeshSubmeshEnd(mesh) - 1);
    getMeshIndexCount = (mesh) => this.getMeshIndexEnd(mesh) - this.getMeshIndexStart(mesh);
    getMeshVertexStart = (mesh) => this.meshVertexOffsets[mesh];
    getMeshVertexEnd = (mesh) => mesh < this.meshVertexOffsets.length - 1 ? this.meshVertexOffsets[mesh + 1] : this.getVertexCount();
    getMeshVertexCount = (mesh) => this.getMeshVertexEnd(mesh) - this.getMeshVertexStart(mesh);
    getMeshSubmeshStart = (mesh) => this.meshSubmeshes[mesh];
    getMeshSubmeshEnd = (mesh) => mesh < this.meshSubmeshes.length - 1 ? this.meshSubmeshes[mesh + 1] : this.submeshIndexOffset.length;
    getMeshSubmeshCount = (mesh) => this.getMeshSubmeshEnd(mesh) - this.getMeshSubmeshStart(mesh);

    // ------------- Submeshes -----------------
    getSubmeshIndexStart = (submesh) => this.submeshIndexOffset[submesh];
    getSubmeshIndexEnd = (submesh) => submesh < this.submeshIndexOffset.length - 1? this.submeshIndexOffset[submesh + 1] : this.indices.length;
    getSubmeshIndexCount = (submesh) => this.getSubmeshIndexEnd(submesh) - this.getSubmeshIndexStart(submesh);
    getSubmeshColor = (submesh) => this.submeshMaterial ? this.getMaterialColor(this.submeshMaterial[submesh]) : this.DEFAULT_COLOR;

    // ------------- Instances -----------------
    getInstanceCount = () => this.instanceMeshes.length;
    getInstanceMatrix = (instance) => this.instanceTransforms.subarray(instance * this.MATRIX_SIZE, (instance + 1) * this.MATRIX_SIZE);

    // ------------- Instances -----------------
    getMaterialCount = () => this.materialColors.length / this.COLOR_SIZE;    
    getMaterialColor = (material) => material < 0 ? this.DEFAULT_COLOR : this.materialColors.subarray(material * this.COLOR_SIZE, (material + 1) * this.COLOR_SIZE);

    static createFromBfast(bfast) {
        const attributes = [];
        for (let name of CommonG3DAttributes.all) {
            const buffer = bfast.getBuffer(name);
            if (buffer) 
                attributes.push(new G3DAttribute(name, buffer));
        }
        return new G3D(attributes);
    }

    validate() {        
        if (!this.positions)
            throw new Error(`Missing Attribute Buffer: positions`);

        if (!this.indices)
            throw new Error(`Missing Attribute Buffer: indices`);

        // Basic
        if (this.positions.length % this.POSITION_SIZE !== 0) {
            throw new Error('Invalid position buffer, must be divisible by ' + this.POSITION_SIZE);
        }
        if (this.indices.length % 3 !== 0) {
            throw new Error('Invalid Index Count, must be divisible by 3');
        }
        for (let i = 0; i < this.indices.length; i++) {
            if (this.indices[i] < 0 || this.indices[i] >= this.positions.length) {
                throw new Error('Vertex index out of bound');
            }
        }
        // Instances
        if (this.instanceMeshes && this.instanceTransforms)
            if (this.instanceMeshes.length !== this.instanceTransforms.length / this.MATRIX_SIZE) 
                throw new Error('Instance buffers mismatched');
        
        if (this.instanceTransforms)
            if (this.instanceTransforms.length % this.MATRIX_SIZE !== 0) 
                throw new Error('Invalid InstanceTransform buffer, must respect arity ' + this.MATRIX_SIZE);
        
        if (this.instanceMeshes) 
            for (let i = 0; i < this.instanceMeshes.length; i++) 
                if (this.instanceMeshes[i] >= this.meshSubmeshes.length) 
                    throw new Error('Instance Mesh Out of range.');
        
        if (this.meshSubmeshes)
            for (let i = 0; i < this.meshSubmeshes.length; i++) 
                if (this.meshSubmeshes[i] < 0 || this.meshSubmeshes[i] >= this.submeshIndexOffset.length) 
                    throw new Error('MeshSubmeshOffset out of bound at ' + i);
            
        
        if (this.meshSubmeshes)
            for (let i = 0; i < this.meshSubmeshes.length - 1; i++) 
                if (this.meshSubmeshes[i] >= this.meshSubmeshes[i + 1]) 
                    throw new Error('MeshSubmesh out of sequence.');
                    
        
        // Submeshes
        if (this.submeshIndexOffset && this.submeshMaterial)
            if (this.submeshIndexOffset.length !== this.submeshMaterial.length) 
                throw new Error('Mismatched submesh buffers');        
        
        if (this.submeshIndexOffset)
            for (let i = 0; i < this.submeshIndexOffset.length; i++) 
                if (this.submeshIndexOffset[i] < 0 || this.submeshIndexOffset[i] >= this.indices.length) 
                    throw new Error('SubmeshIndexOffset out of bound');

        if (this.submeshIndexOffset)
            for (let i = 0; i < this.submeshIndexOffset.length; i++) 
                if (this.submeshIndexOffset[i] % 3 !== 0) 
                    throw new Error('Invalid SubmeshIndexOffset, must be divisible by 3');
        
        if (this.submeshIndexOffset)
            for (let i = 0; i < this.submeshIndexOffset.length - 1; i++) 
                if (this.submeshIndexOffset[i] >= this.submeshIndexOffset[i + 1]) 
                    throw new Error('SubmeshIndexOffset out of sequence.');

        if (this.submeshMaterial)
            for (let i = 0; i < this.submeshMaterial.length; i++) 
                if (this.submeshMaterial[i] >= this.materialColors.length) 
                    throw new Error('SubmeshMaterial out of bound');
        
        // Materials
        if (this.materialColors)
            if (this.materialColors.length % this.COLOR_SIZE !== 0) 
                throw new Error('Invalid material color buffer, must be divisible by ' + this.COLOR_SIZE);        
    }
}

class G3DMaterials 
{
    opaque;
    transparent;
    wireframe;
    constructor() {
        this.opaque = this.patchMaterial(new MeshPhongMaterial({
            color: 0x999999,
            vertexColors: true,
            flatShading: true,
            side: DoubleSide,
            shininess: 70
        }));            
        this.transparent = this.patchMaterial(new MeshPhongMaterial({
            color: 0x999999,
            vertexColors: true,
            flatShading: true,
            side: DoubleSide,
            shininess: 70,
            transparent: true,
        }));            
        this.wireframe = new LineBasicMaterial({
            depthTest: false,
            opacity: 1,
            color: new Color(0x0000ff),
            transparent: true
        });
    }
        
    /**
     * Adds feature to default three material to support color change.
     * Developed and tested for Phong material, but might work for other materials.
     */
    patchMaterial(material) {
        material.onBeforeCompile = (shader) => {
            this.patchShader(shader);
            material.userData.shader = shader;
        };
        return material;
    }
    /**
     * Patches phong shader to be able to control when lighting should be applied to resulting color.
     * Instanced meshes ignore light when InstanceColor is defined
     * Instanced meshes ignore vertex color when instance attribute useVertexColor is 0
     * Regular meshes ignore light in favor of vertex color when uv.y = 0
     */
    patchShader(shader) {
        shader.vertexShader = shader.vertexShader
            // Adding declarations for attributes and varying for visibility and coloring.
            .replace('#include <color_pars_vertex>', `
            #include <color_pars_vertex>
            
            // COLORING

            // attribute for color override
            // merged meshes use it as vertex attribute
            // instanced meshes use it as an instance attribute
            attribute float colored;

            // There seems to be an issue where setting mehs.instanceColor
            // doesn't properly set USE_INSTANCING_COLOR
            // so we always use it as a fix
            #ifndef USE_INSTANCING_COLOR
            attribute vec3 instanceColor;
            #endif

            // Passed to fragment to ignore phong model
            varying float vColored;
            
            // VISIBILITY

            // Instance or vertex attribute to hide objects 
            #ifdef USE_INSTANCING
                attribute float ignoreInstance;
            #else
                attribute float ignoreVertex;
            #endif

            // Passed to fragment to discard them
            varying float vIgnore;

        `)
            // Adding vertex shader logic for visility and coloring
            .replace('#include <color_vertex>', `
            vColor = color;
            vColored = colored;

            // COLORING

            // colored == 1 -> instance color
            // colored == 0 -> vertex color
            #ifdef USE_INSTANCING
            vColor.xyz = colored * instanceColor.xyz + (1.0f - colored) * color.xyz;
            #endif


            // VISIBILITY

            // Set frag ignore from instance or vertex attribute
            #ifdef USE_INSTANCING
            vIgnore = ignoreInstance;
            #else
            vIgnore = ignoreVertex;
            #endif

        `);
        shader.fragmentShader = shader.fragmentShader
            // Adding declarations for varying defined in vertex shader
            .replace('#include <clipping_planes_pars_fragment>', `
                #include <clipping_planes_pars_fragment>
                varying float vIgnore;
                varying float vColored;
            `)
            // Adding fragment shader logic for visibility and coloring.
            .replace('#include <output_fragment>', `
            // VISIBILITY
            if (vIgnore > 0.0f)
            discard;
            
            // COLORING
            // vColored == 1 -> Vertex Color * light 
            // vColored == 0 -> Phong Color 
            float d = length(outgoingLight);
            gl_FragColor = vec4(vColored * vColor.xyz * d + (1.0f - vColored) * outgoingLight.xyz, diffuseColor.a);
        `);
        return shader;
    }  
}

class G3DToThreeJs 
{
    static createGroup(g3d, materials = new G3DMaterials()) {
        const result = new Group();
        const meshes = G3DToThreeJs.createMeshes(g3d, materials);
        for (let m of meshes)
            result.add(m);
        return result;
    }

    /**
     * Returns an array of meshes from the g3d data, materials, and a list of indices
     */
     static createMeshes(g3d, materials) {
        const result = [];
        for (let mesh = 0; mesh < g3d.getMeshCount(); mesh++) {
            const useAlpha = g3d.meshTransparent[mesh];
            const geometry = G3DToThreeJs.createGeometryFromMesh(g3d, mesh, useAlpha);
            const material = useAlpha ? materials.transparent : materials.opaque;
            let meshInstances = g3d.meshInstances[mesh];
            if (!meshInstances)
            {
                result.push(new Mesh(geometry, material));
            }
            else
            {                         
                const resultMesh = G3DToThreeJs.createInstancedMesh(g3d, geometry, meshInstances, material);
                result.push(resultMesh);
            }
        }
        return result;
    }

    /**
     * Creates a InstancedMesh from g3d data and an array of instance indices
     */
    static createInstancedMesh(g3d, geometry, instances, material) {
        const result = new InstancedMesh(geometry, material, instances.length);
        for (let i = 0; i < instances.length; i++) {
            const matrix = G3DToThreeJs.getInstanceMatrix(g3d, instances[i]);
            result.setMatrixAt(i, matrix);
        }
        result.userData.instances = instances;
        return result;
    }

    /**
     * Creates a BufferGeometry from a given mesh index in the g3d
     */
    static createGeometryFromMesh(g3d, mesh, useAlpha) {
        return G3DToThreeJs.createGeometryFromArrays(
            g3d.positions.subarray(g3d.getMeshVertexStart(mesh) * 3, 
            g3d.getMeshVertexEnd(mesh) * 3), 
            g3d.indices.subarray(g3d.getMeshIndexStart(mesh), g3d.getMeshIndexEnd(mesh)), 
            G3DToThreeJs.createVertexColors(g3d, mesh, useAlpha), 
            useAlpha ? 4 : 3);
    }

    /**
     * Expands submesh colors into vertex colors as RGB or RGBA
     */
    static createVertexColors(g3d, mesh, useAlpha) {
        const colorSize = useAlpha ? 4 : 3;
        const result = new Float32Array(g3d.getMeshVertexCount(mesh) * colorSize);
        const subStart = g3d.getMeshSubmeshStart(mesh);
        const subEnd = g3d.getMeshSubmeshEnd(mesh);
        for (let submesh = subStart; submesh < subEnd; submesh++) {
            const color = g3d.getSubmeshColor(submesh);
            const start = g3d.getSubmeshIndexStart(submesh);
            const end = g3d.getSubmeshIndexEnd(submesh);
            for (let i = start; i < end; i++) {
                const v = g3d.indices[i] * colorSize;
                result[v] = color[0];
                result[v + 1] = color[1];
                result[v + 2] = color[2];
                if (useAlpha)
                    result[v + 3] = color[3];
            }
        }
        return result;
    }

    /**
     * Creates a BufferGeometry from given geometry data arrays
     * @param vertices vertex data with 3 number per vertex (XYZ)
     * @param indices index data with 3 indices per face
     * @param vertexColors color data with 3 or 4 number per vertex. RBG or RGBA
     * @param colorSize specify whether to treat colors as RGB or RGBA
     * @returns a BufferGeometry
     */
    static createGeometryFromArrays(vertices, indices, vertexColors = undefined, colorSize = 3) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(vertices, 3));
        geometry.setIndex(new Uint32BufferAttribute(indices, 1));
        if (vertexColors) 
            geometry.setAttribute('color', new BufferAttribute(vertexColors, colorSize));        
        return geometry;
    }

    static getInstanceMatrix(g3d, instance, target = new Matrix4()) {
        target.fromArray(g3d.getInstanceMatrix(instance));
        return target;
    }                  
}

class G3DLoader extends Loader 
{
	constructor( manager ) {
		super( manager );
	}

	load( url, onLoad, onProgress, onError ) {
		const scope = this;
		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );

		loader.load( url, function ( text ) 
        {
			try 
            {
				onLoad( scope.parse( text ) );
			} 
            catch ( e ) 
            {
				if ( onError ) 
                {
					onError( e );
				} 
                else 
                {
					console.error( e );
				}
				scope.manager.itemError( url );
			}
		}, 
        onProgress, 
        onError );
	}

	parse( data ) {
		let bfast = BFast.parseFromBuffer(data);
        console.log(bfast);
        // VIM files are BFAST files that store their geometry in a child BFAST buffer called "geometry" as a G3D
        if (bfast.children.has('geometry')) {
            bfast = bfast.children.get('geometry');
        }
        const g3d = G3D.createFromBfast(bfast);
        console.log(g3d);
        const group = G3DToThreeJs.createGroup(g3d);
        console.log(group);
        return group;
	}
}

export { G3DLoader, G3D, BFast, BFastHeader, G3DToThreeJs, G3DMaterials, G3DAttribute, G3DAttributeDescriptor };
