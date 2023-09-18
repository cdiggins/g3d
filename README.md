

<p align="center">
 <img src="./img/Transparent Logo Cropped.png" width=100>
</p>
<h1 align="center">G3D</h1>

G3D is an extensible data format for the simple and efficient representation and serialization of instanced static mesh geometry. 

# Contents of this Repository 

This repo contains C++, C#, and JavaScript implementations of G3D importers and exporters, and a number of test models and test projects.  

# G3D versus FBX

FBX is an older closed format that requires an SDK to read and write reliably, making it incompatible with web clients. It was designed for the moving 3D assets, particularly those with animations, between art tools and game engines. It was not designed as a "render ready" format or as a format that can be easily serialized at run-time. 

G3D on the other hand is an open-specification that is optimized for fast loading of static geometry onto the GPU on any device. We provide open implementations of G3D in C#, JavaScript, and C++. 

Reading a G3D file is an order of magnitude faster than FBX files. 

# G3D versus glTF

The glTF is a more appropriate format for serializing complex animated 3D scenes such as those with camera, lights, shaders, bones, and skinning information.  

G3D is more appropriate for single mesh data, or static scenes with lots of instancing, such as those create by engineering and architectural CAD and BIM software. 

The G3D format is generally the same size as a binary glTF file (.GLB). The G3D Three.JS loader can be 2x or more faster than the GLTF loader for GLB files. 

It is much simpler to write efficient and conformant loaders and exporters of G3D than for glTF, given the reduced scope of the design and a more opinionated binary layout.     

# Repository Structure and Projects

On this Github repository we have the following projects:

* `csharp\Vim.G3d` - C# .NET Standard 2.0 Library for reading/writing G3D buffers 
* `csharp\Vim.G3d.AssimpAdapter` - C# .NET Framework 4.7.1 library for converting from Assimp meshes to G3D data structures
* `csharp\Vim.G3d.Test` - C# .NET Core 2.1 project with NUnit tests 
* `csharp\Vim.G3d.UnityAdapter` - C# .NET Framework 4.7.1 library for converting to/from Unity types (tested with Unit 2019.1) 
* `unity\Vim.G3d.Unity` - A Unity 2019.1.14 project for testing the Unity adapters  

# Format 

## BFAST Container

The underlying binary layout of a G3D file conforms to the [BFAST serialization format](https://github.com/vimaec/bfast), which is a simple and efficient binary format for serializing collections of byte arrays. BFAST provides an interface that allows named arrays of binary data to be serialized and deserialized quickly and easily.

The first named buffer in the BFAST container is reserved for meta-information about the file encoded in JSON format. It has the name "meta". Each subsequent buffer uses the attribute descriptor string as a name. 

## Meta-Information

The first buffer of a G3D file is a JSON object where each field value must be a string. There is no requirement for the names and the values of the fields. 

## Attributes
 
### Attribute Descriptor String

Every attribute descriptor has a one to one mapping to a string representation similar to a URN: 
    
    `g3d:<association>:<semantic>:<index>:<data_type>:<data_arity>`

This attribute descriptor string is the name of the buffer. 

### Association

G3D is organized as a collection of attribute buffers. Each attributes describe what part of the incoming geometry they are associated with:

* vertex - per point data
* corner - per face-vertex data 
* face - per polygon data
* edge - per directed edge (aka half-edge) data 
* mesh - per mesh data 
* submesh - pre submesh data  
* instance - per object data (e.g. world transform matrices)
* all -  whole object data (e.g. face-size of 4 with whole object indicates a quad mesh)

### Semantic

Attributes also have a "semantic" which is used to identify what role the attribute has when parsing. These map roughly to FBX layer elements, or Three.JS buffer attributes. There are a number of predefined semantic values with reserved names, but applications are free to define custom semantic values. The only required semantic in a G3D file is "position". Here is a list of some of the predefined semantics: 

* unknown,       // no known attribute type
* position,      // vertex buffer 
* index,         // index buffer
* indexoffset,   // an offset into the index buffer (used with groups and with faces)
* vertexoffset,  // the offset into the vertex buffer (used only with groups, and must have offset.)
* normal,        // computed normal information (per face, group, corner, or vertex)
* binormal,      // computed binormal information 
* tangent,       // computed tangent information 
* materialid,    // material id
* visibility,    // visibility data
* size,          // number of indices per face or group
* uv,            // UV (sometimes more than 1, e.g. Unity supports up to 8)
* color,         // usually vertex color, but could be edge color as well
* smoothing,     // identifies smoothing groups (e.g. ala 3ds Max and OBJ files)
* weight,        // in 3ds Max this is called selection 
* mapchannel,    // 3ds Max map channel (assoc of none => map verts, assoc of corner => map faces)
* id,            // used to identify what object each face part came from 
* joint,         // used to identify what a joint a skin is associated with 
* boxes,         // used to identify bounding boxes
* spheres,       // used to identify bounding spheres
* user,          // identifies user specific data (in 3ds Max this could be "per-vertex-data")

### Index

Attributes use indices to distinguish when multiple attributes share the same name (e.g. uv:0 ... uv:8)

### Data Type

Attributes are stored in 512-byte aligned data-buffers arranged as arrays of scalars or fixed width vectors. The individual data values can be integers, or floating point values of various widths from 1 to 8 bytes. The data-types are:

* int8
* int16
* int32
* int64
* uint8
* uint16
* uint32
* uint64
* float32
* float64

### Arity

The number of primitives per data element is called the "arity" and can be any integer value greater than zero. 

## Encoding Strings

While there is no explicit string type, one could encode string data by using a data-type uint8 with an arity of a fixed value (say 255) to store short strings. 

# Recommended reading:

* [VIM AEC blog post about using G3D with Unity](https://www.vimaec.com/blog/the-g3d-geometry-exchange-format/)
* [Hackernoon article about BFast](https://hackernoon.com/bfast-a-data-format-for-serializing-named-binary-buffers-243p130uw)
* http://assimp.sourceforge.net/lib_html/structai_mesh.html
* http://help.autodesk.com/view/FBX/2017/ENU/?guid=__files_GUID_5EDC0280_E000_4B0B_88DF_5D215A589D5E_htm
* https://help.autodesk.com/cloudhelp/2017/ENU/Max-SDK/cpp_ref/class_mesh.html
* https://help.autodesk.com/view/3DSMAX/2016/ENU/?guid=__files_GUID_CBBA20AD_F7D5_46BC_9F5E_5EDA109F9CF4_htm
* http://paulbourke.net/dataformats/
* http://paulbourke.net/dataformats/obj/
* http://paulbourke.net/dataformats/ply/
* http://paulbourke.net/dataformats/3ds/
* https://github.com/KhronosGroup/gltf
* http://help.autodesk.com/view/FBX/2017/ENU/?guid=__cpp_ref_class_fbx_layer_element_html
