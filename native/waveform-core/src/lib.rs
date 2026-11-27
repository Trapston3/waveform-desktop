pub mod autoeq;
pub mod dsp;
pub mod onnx_engine;
pub mod scanner;

pub fn native_core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
