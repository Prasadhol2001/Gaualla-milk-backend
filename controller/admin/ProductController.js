import pool from "../../config.js";
import fs from "fs"
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);






const createCategory = async (req, res) => {
  try {
    console.log("req.body 👉", req.body);
    console.log("req.file 👉", req.file);

    const { category } = req.body;  // ✅ Multer populates this
    const { filename } = req.file;  // ✅ uploaded image file

    if (!category || !filename) {
      return res.status(400).json({ error: "Category and Image are required" });
    }

    console.log("Inserting category:", category.toLowerCase(), filename);

    const [store] = await pool.execute(
      `INSERT INTO categories (name, image, status) VALUES (?, ?, ?)`,
      [category.toLowerCase(), filename, 'active']
    );

    console.log("Insert result:", store);

    return res.json({
      message: "✅ Category added successfully",
      success:true
    });

  } catch (error) {
    console.error("❌ Error in createCategory:", error);
    console.error("Error details:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({ error: "Something went wrong", details: error.message });
  }
};



const getCategory = async(req,res)=>{
  try {
    console.log("Testing database connection...");
    const [category]= await pool.query(`SELECT * FROM categories`)
    console.log("Query successful, categories:", category.length);
    if(category.length ===0){
  return    res.json({success:false})
    }

      return res.json({success:true,category});
  } catch (error) {
    console.error("Database error in getCategory:", error);
    return res.status(500).json({success:false, error: error.message});
  }
}



const getSingleCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(`SELECT * FROM categories WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    return res.json({ success: true, category: rows[0] });
  } catch (error) {
    console.error("Error fetching single category:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { category } = req.body;
    const filename = req.file ? req.file.filename : null;

    // Get current category
    const [rows] = await pool.execute(`SELECT * FROM categories WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    const currentCategory = rows[0];

    let updateQuery = `UPDATE categories SET name = ?`;
    let params = [category.toLowerCase()];

    if (filename) {
      updateQuery += `, image = ?`;
      params.push(filename);

      // Delete old image if new one uploaded
      const oldImagePath = path.join(__dirname, "../../uploads", currentCategory.image);
      fs.unlink(oldImagePath, (err) => {
        if (err) console.error("Old image delete error:", err.message);
      });
    }

    updateQuery += ` WHERE id = ?`;
    params.push(id);

    await pool.execute(updateQuery, params);

    return res.json({ success: true, message: "Category updated successfully" });
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get category details
    const [rows] = await pool.execute(`SELECT image FROM categories WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const category = rows[0];

    // 2. Delete from DB
    await pool.execute(`DELETE FROM categories WHERE id = ?`, [id]);

    // 3. Delete image file
    const imagePath = path.join(__dirname, "../../uploads", category.image);
    fs.unlink(imagePath, (err) => {
      if (err) console.error("Image delete error:", err.message);
    });

    return res.status(200).json({ success: true, message: "Category deleted successfully" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};




export const creatProduct= async(req,res)=>{
  try {
    const {
      category_id,
      name,
      slug,
      description,
      price,
      old_price,
      stock,
      unit_quantity,
      details,
      one_time,
      description2,
      is_best_seller,
      variants,
    } = req.body;

    // ✅ Validate required fields
    if (!category_id || !name || !slug || !price || !stock) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields: category_id, name, slug, price, stock" 
      });
    }

    // ✅ Validate numeric fields
    const categoryIdNum = parseInt(category_id);
    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock);
    
    if (isNaN(categoryIdNum) || isNaN(priceNum) || isNaN(stockNum)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid data types for category_id, price, or stock" 
      });
    }

    // ✅ Validate category exists
    const [[categoryExists]] = await pool.query(
      `SELECT id FROM categories WHERE id = ?`,
      [categoryIdNum]
    );
    if (!categoryExists) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid category_id - category does not exist" 
      });
    }

    // ✅ Handle images - can be empty
    const images = req.files && req.files.length > 0
      ? JSON.stringify(req.files.map((file) => file.filename))
      : JSON.stringify([]);

    // ✅ Convert one_time to boolean
    const oneTimeFlag = one_time === 'true' || one_time === true || one_time === 1 || one_time === '1' ? 1 : 0;
    const bestSellerFlag = is_best_seller === 'true' || is_best_seller === true || is_best_seller === 1 || is_best_seller === '1' ? 1 : 0;
    const variantsVal = variants ? (typeof variants === 'string' ? variants : JSON.stringify(variants)) : null;

    await pool.execute(
      `INSERT INTO products 
      (category_id, name, slug, description, price, old_price, stock, unit_quantity, details, one_time, images, description2, is_best_seller, variants) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryIdNum,
        name.trim(),
        slug.trim(),
        description || null,
        priceNum,
        old_price ? parseFloat(old_price) : null,
        stockNum,
        unit_quantity || null,
        details || null,
        oneTimeFlag,
        images,
        description2 || null,
        bestSellerFlag,
        variantsVal,
      ]
    );

    return res.json({ success: true, message: "Product created successfully" });
  } catch (error) {
    console.error("Product creation error:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
}

  export const getallProduct=async(req,res)=>{
try {

const [product]= await pool.query(`
      SELECT 
        p.*,
        c.name AS category
      FROM products p
      JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
    `);
if(product.length ==0){
  return res.json({success:false})
}

    return res.json({success:true,product})

  
} catch (error) {
    return res.json({success:false,message:error.message})

}
  }



const getProductByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    if (category === "all") {
      const [product] = await pool.query(`
        SELECT 
          p.*,
          c.name AS category
        FROM products p
        JOIN categories c ON p.category_id = c.id
        
      `);

      if (product.length === 0) {
        return res.json({ success: false });
      }

      // ✅ Parse images
      const parsedProducts = product.map(p => ({
        ...p,
        images: safeParseJSON(p.images)
      }));

      return res.json({ success: true, product: parsedProducts });
    } else {
      // 1. Find category
      const [[cate]] = await pool.query(
        `SELECT * FROM categories WHERE name = ?`,
        [category]
      );

      if (!cate) {
        return res.json({ success: false, message: "Category not found" });
      }

      
      const [products] = await pool.query(
        `SELECT 
            p.*,
            c.name AS category
          FROM products p
          JOIN categories c ON p.category_id = c.id
          WHERE p.category_id = ?
          `,
        [cate.id]
      );

      if (products.length === 0) {
        return res.json({ success: false, message: "No products found" });
      }

      // ✅ Parse images
      const parsedProducts = products.map(p => ({
        ...p,
        images: safeParseJSON(p.images)
      }));

      return res.json({ success: true, product: parsedProducts });
    }
  } catch (error) {
    console.error(error);
    return res.json({ success: false, message: error.message });
  }
};
 
// Helper function to safely parse JSON
function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return []; // fallback if invalid JSON
  }
}

const getSinglePRoduct=async(req,res)=>{
const {slug}=req.params;

const [[product]]= await pool.query(`SELECT * FROM products WHERE slug = ?`,[slug]);
if(!product){
return res.json({success:false})
}
return res.json({success:true,product});


}

// Get product by ID (for admin edit page)
const getProductById = async(req,res)=>{
  try {
    const { id } = req.params;
    const [product] = await pool.query(`SELECT * FROM products WHERE id = ?`, [id]);
    if(product.length === 0){
      return res.json({success:false, message: "Product not found"})
    }
    return res.json({success:true, product: product[0]});
  } catch (error) {
    console.error("Error fetching product by ID:", error);
    return res.json({success:false, message: error.message});
  }
}




// Search products by name
const searchProduct = async (req, res) => {
  try {
    const { search } = req.params;

    if (!search) {
      return res.status(400).json({ message: "Search term is required" });
    }

    const [products] = await pool.query(
      "SELECT * FROM products WHERE name LIKE ?",
      [`%${search}%`]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: "No products found" });
    }

    return res.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("Error searching products:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      category_id,
      name,
      slug,
      description,
      price,
      old_price,
      stock,
      unit_quantity,
      details,
      one_time,
      description2,
      is_best_seller,
      variants,
    } = req.body;

    // Get current product
    const [rows] = await pool.execute(`SELECT * FROM products WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const currentProduct = rows[0];

    // Validate required fields
    if (!category_id || !name || !slug || !price || !stock) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: category_id, name, slug, price, stock"
      });
    }

    // Validate numeric fields
    const categoryIdNum = parseInt(category_id);
    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock);

    if (isNaN(categoryIdNum) || isNaN(priceNum) || isNaN(stockNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid data types for category_id, price, or stock"
      });
    }

    // Validate category exists
    const [[categoryExists]] = await pool.query(
      `SELECT id FROM categories WHERE id = ?`,
      [categoryIdNum]
    );
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: "Invalid category_id - category does not exist"
      });
    }

    // Handle images - can be empty or new files
    let images = currentProduct.images; // Keep existing images by default
    if (req.files && req.files.length > 0) {
      // New images uploaded - replace existing ones
      images = JSON.stringify(req.files.map((file) => file.filename));

      // Delete old images
      if (currentProduct.images) {
        try {
          const oldImages = safeParseJSON(currentProduct.images);
          oldImages.forEach(image => {
            const imagePath = path.join(__dirname, "../../uploads", image);
            fs.unlink(imagePath, (err) => {
              if (err) console.error("Old image delete error:", err.message);
            });
          });
        } catch (e) {
          console.error("Error parsing old images for deletion:", e);
        }
      }
    }

    // Convert one_time to boolean
    const oneTimeFlag = one_time === 'true' || one_time === true || one_time === 1 || one_time === '1' ? 1 : 0;
    const bestSellerFlag = is_best_seller === 'true' || is_best_seller === true || is_best_seller === 1 || is_best_seller === '1' ? 1 : 0;
    const variantsVal = variants ? (typeof variants === 'string' ? variants : JSON.stringify(variants)) : null;

    // Update product
    await pool.execute(
      `UPDATE products SET
        category_id = ?,
        name = ?,
        slug = ?,
        description = ?,
        price = ?,
        old_price = ?,
        stock = ?,
        unit_quantity = ?,
        details = ?,
        images = ?,
        one_time = ?,
        description2 = ?,
        is_best_seller = ?,
        variants = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        categoryIdNum,
        name.trim(),
        slug.trim(),
        description || null,
        priceNum,
        old_price ? parseFloat(old_price) : null,
        stockNum,
        unit_quantity || null,
        details || null,
        images,
        oneTimeFlag,
        description2 || null,
        bestSellerFlag,
        variantsVal,
        id,
      ]
    );

    return res.json({ success: true, message: "Product updated successfully" });
  } catch (error) {
    console.error("Error updating product:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get product details (including images)
    const [rows] = await pool.execute(`SELECT images FROM products WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const product = rows[0];

    // 2. Delete from DB
    await pool.execute(`DELETE FROM products WHERE id = ?`, [id]);

    // 3. Delete image files if they exist
    if (product.images) {
      try {
        const images = safeParseJSON(product.images);
        images.forEach(image => {
          const imagePath = path.join(__dirname, "../../uploads", image);
          fs.unlink(imagePath, (err) => {
            if (err) console.error("Image delete error:", err.message);
          });
        });
      } catch (e) {
        console.error("Error parsing images for deletion:", e);
      }
    }

    return res.status(200).json({ success: true, message: "Product deleted successfully" });

  } catch (error) {
    console.error("Error deleting product:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const Categorycontroler={
   createCategory ,
   getProductById,
   getCategory,
   getSingleCategory,
   updateCategory,
   deleteCategory,
   creatProduct,
   getallProduct,
   getProductByCategory,
   getSinglePRoduct,
   searchProduct,
   updateProduct,
   deleteProduct,
}

