// Define a clear interface for our block structure.
export interface OcrBlock {
    text: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    [key:string]: any;
  }
  
  // Define an interface for image dimensions.
  export interface Dimensions {
    width: number;
    height: number;
  }
  
  /**
   * A utility class that reliably transforms rotated OCR coordinates onto a
   * GUARANTEED landscape canvas.
   */
  export class CoordinateCorrector {
    private readonly imageDimensions: Dimensions;
  
    constructor(imageDimensions: Dimensions) {
      if (!imageDimensions || imageDimensions.width <= 0 || imageDimensions.height <= 0) {
        throw new Error("[FAIL] CoordinateCorrector: Invalid image dimensions provided.");
      }
      // This check is crucial: we enforce a landscape standard here.
      if (imageDimensions.height > imageDimensions.width) {
          throw new Error(`[FAIL] CoordinateCorrector: Received a portrait canvas (${imageDimensions.width}x${imageDimensions.height}). The pipeline standard is landscape.`);
      }
      this.imageDimensions = imageDimensions;
      console.log(`🗺️  CoordinateCorrector initialized for a ${imageDimensions.width}x${imageDimensions.height} canvas.`);
    }
  
    public transformAndValidateAll(rawBlocks: any[]): OcrBlock[] {
      console.log(`🔄 Transforming and validating ${rawBlocks.length} raw blocks...`);
      
      const correctedBlocks = rawBlocks.map(block => {
        const transformedBlock = this.transformSingleBlock(block);
        this.validateSingleBlock(transformedBlock);
        return transformedBlock;
      });
      
      console.log(`✅ All ${correctedBlocks.length} blocks successfully transformed and validated.`);
      return correctedBlocks;
    }
  
    private transformSingleBlock(block: any): OcrBlock {
      const obb = block.boundingBox; 
  
      // This is the correct formula for mapping the OCR's rotated system
      // onto our standardized landscape canvas.
      const transformed = {
        x: obb.y,
        y: this.imageDimensions.width - (obb.x + obb.width), 
        width: obb.height,
        height: obb.width,
      };
  
      return {
        ...block,
        boundingBox: transformed,
      };
    }
  
    private validateSingleBlock(block: OcrBlock): void {
      const { x, y, width, height } = block.boundingBox;
      
      const isInvalid = x < 0 || y < 0 || 
                        (x + width) > this.imageDimensions.width || 
                        (y + height) > this.imageDimensions.height;
  
      if (isInvalid) {
        console.error("❌ [VALIDATION FAILED] Block details:", { text: block.text, boundingBox: block.boundingBox, imageDimensions: this.imageDimensions });
        throw new Error(`[FAIL] Block with text "${block.text.substring(0, 30)}..." has coordinates outside the image boundaries after transformation. The rotation formula is still incorrect.`);
      }
    }
  }