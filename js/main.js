const fs = require("fs")
const path = require("path")

const gltfPipeline = require("gltf-pipeline")
const commandLineArgs = require("command-line-args")

// fix XMLHttpRequest and document issues for three.js on node
// var XMLHttpRequest = require("xhr2")
// global.XMLHttpRequest = XMLHttpRequest

const atob = require("atob")
const { Blob, FileReader } = require("vblob")
const { Image } = require("image-js")
const THREE = require("three")

//==


/*let loaderModule;

 const main = async () => {
    loaderModule = await import("./node_modules/three/examples/jsm/loaders/STLLoader.js");
    console.log(loaderModule);
    return loaderModule;
}*/

const ThreeJsLoaderExtensions = {
    Rhino3dmLoader: [".3dm"],
    ColladaLoader: [".dae"],
    FBXLoader: [".fbx"],
    GLTFLoader: [".gltf", ".glb"],
    IFCLoader: [".ifc"],
    OBJLoader: [".obj"],
    PCDLoader: [".pcd"],
    STLLoader: [".stl"],
    G3DLoader: [".g3d", ".vim"],
    VRMLLoader: [".vrm", ".vrml"],
    XYZLoader: [".xyz"],
    PLYLoader: [".ply"],
};

const ThreeJsExporterExtensions = {
    ColladaExporter: [".dae"],
    GLTFExporter: [".gltf", ".glb"],
    OBJExporter: [".obj"],
    PLYExporter: [".ply"],
    STLExporter: [".stl"],
    USDZExporter: [".usdz", ".usd"],
}

const threeJsLoaderPath = (name) => {
    if (name == "G3DLoader") return "./G3DLoader.mjs";
    if (name == "Rhino3dmLoader") name = "3DMLoader";
    return `./node_modules/three/examples/jsm/loaders/${name}.js`;
}

const threeJsExporterPath = (name) => {
    return `./node_modules/three/examples/jsm/exporters/${name}.js`;
}

const threeJsLoader = async (name) => 
    import(threeJsLoaderPath(name)).then(module => module[name] || module);

const threeJsExporter = async (name) => 
    import(threeJsExporterPath(name)).then(module => module[name] || module);

const getLoaders = async () => 
{
    const values = await Promise.all(Object.keys(ThreeJsLoaderExtensions).map(x => [x, threeJsLoader(x)]));
    return new Map(values);
}

const getExporters = async () =>
{ 
    const values = await Promise.all(Object.keys(ThreeJsExporterExtensions).map(x => [x, threeJsExporter(x)]));
    return new Map(values);
}

async function main() {
    const ThreeJsExporters = {}    
    const ThreeJsLoaders = {}
    for (const k in ThreeJsExporterExtensions)
        ThreeJsExporters[k] = await threeJsExporter(k); 
    for (const k in ThreeJsLoaderExtensions)
        ThreeJsLoaders[k] = await threeJsLoader(k); 
    console.log(ThreeJsExporters);
    console.log(ThreeJsLoaders);
}

main();

//==

const glob = require("glob")
const options = {}

// options is optional
glob("**/*.gltf", options, function (er, files) {
  // files is an array of filenames.
  // If the `nonull` option is set, and nothing
  // was found, then files is ["**/*.js"]
  // er is an error object or null.
  console.log(files);
})